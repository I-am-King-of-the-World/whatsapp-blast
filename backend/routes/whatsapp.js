const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { рассылки } = require('../db');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

const клиенты = new Map();
const статусы = new Map();

function найтиChromium() {
  // Явный путь из env
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  // Попробовать через which
  try {
    const пути = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
    for (const имя of пути) {
      try {
        const путь = execSync(`which ${имя} 2>/dev/null`).toString().trim();
        if (путь) return путь;
      } catch {}
    }
  } catch {}
  // Nix стандартные пути
  const nixПути = [
    '/run/current-system/sw/bin/chromium',
    '/nix/var/nix/profiles/default/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ];
  for (const п of nixПути) {
    if (fs.existsSync(п)) return п;
  }
  return undefined;
}

const CHROMIUM_PATH = найтиChromium();
console.log('Chromium путь:', CHROMIUM_PATH || 'не найден, используем встроенный');

function удалитьСессию(userId) {
  const папка = path.join('./sessions', `session-user_${userId}`);
  try {
    if (fs.existsSync(папка)) {
      fs.rmSync(папка, { recursive: true, force: true });
      console.log(`Сессия удалена: ${папка}`);
    }
  } catch (e) {
    console.error('Ошибка удаления сессии:', e.message);
  }
}

function создатьКлиент(userId, сбросить = false) {
  if (клиенты.has(userId)) {
    try { клиенты.get(userId).destroy(); } catch {}
    клиенты.delete(userId);
  }

  if (сбросить) удалитьСессию(userId);

  статусы.set(userId, { статус: 'инициализация', qr: null });

  const puppeteerОпции = {
    headless: true,
    timeout: 60000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
    ]
  };
  if (CHROMIUM_PATH) puppeteerОпции.executablePath = CHROMIUM_PATH;

  const клиент = new Client({
    authStrategy: new LocalAuth({ clientId: `user_${userId}`, dataPath: './sessions' }),
    puppeteer: puppeteerОпции,
    webVersionCache: { type: 'remote', remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1023460710-alpha.html' }
  });

  клиент.on('qr', async (qr) => {
    статусы.set(userId, { статус: 'ожидание_qr', qr: await qrcode.toDataURL(qr) });
  });
  клиент.on('ready', () => {
    console.log(`WhatsApp готов для ${userId}`);
    статусы.set(userId, { статус: 'подключён', qr: null });
  });
  клиент.on('disconnected', (reason) => {
    console.log(`WhatsApp отключён (${userId}):`, reason);
    статусы.set(userId, { статус: 'отключён', qr: null });
    клиенты.delete(userId);
  });
  клиент.on('auth_failure', (msg) => {
    console.log(`Ошибка авторизации (${userId}):`, msg);
    статусы.set(userId, { статус: 'ошибка_авторизации', qr: null });
    клиенты.delete(userId);
    удалитьСессию(userId);
  });

  клиент.initialize().catch(e => {
    console.error(`Ошибка инициализации (${userId}):`, e.message);
    статусы.set(userId, { статус: 'ошибка', qr: null });
    клиенты.delete(userId);
  });

  клиенты.set(userId, клиент);
}

// Подключить (обычный)
router.post('/connect', authMiddleware, (req, res) => {
  создатьКлиент(req.пользователь.id, false);
  res.json({ сообщение: 'Инициализация начата' });
});

// Переподключить со сбросом сессии
router.post('/reconnect', authMiddleware, (req, res) => {
  создатьКлиент(req.пользователь.id, true);
  res.json({ сообщение: 'Сессия сброшена, инициализация начата' });
});

router.get('/status', authMiddleware, (req, res) => {
  res.json(статусы.get(req.пользователь.id) || { статус: 'не_подключён', qr: null });
});

router.post('/disconnect', authMiddleware, async (req, res) => {
  const userId = req.пользователь.id;
  const клиент = клиенты.get(userId);
  if (клиент) {
    try { await клиент.logout(); } catch {}
    try { await клиент.destroy(); } catch {}
    клиенты.delete(userId);
  }
  удалитьСессию(userId);
  статусы.set(userId, { статус: 'отключён', qr: null });
  res.json({ успех: true });
});

router.post('/send', authMiddleware, async (req, res) => {
  const userId = req.пользователь.id;
  const { номера, текст } = req.body;
  if (!номера?.length) return res.status(400).json({ ошибка: 'Нет номеров' });
  if (!текст) return res.status(400).json({ ошибка: 'Нет текста' });

  const данные = статусы.get(userId);
  const клиент = клиенты.get(userId);
  if (!клиент || данные?.статус !== 'подключён') return res.status(400).json({ ошибка: 'WhatsApp не подключён' });

  const запись = await рассылки.insert({ userId, текст, количество: номера.length, успешно: 0, статус: 'в_процессе', создана: new Date().toISOString() });
  res.json({ рассылка_id: запись._id, сообщение: 'Рассылка начата' });

  let успешно = 0;
  for (const номер of номера) {
    try {
      let чистый = номер.replace(/\D/g, '');
      if (чистый.length < 10) continue;

      // Казахстан: 8XXXXXXXXXX → 7XXXXXXXXXX
      if (чистый.length === 11 && чистый.startsWith('8')) {
        чистый = '7' + чистый.slice(1);
      }
      // Без кода страны (10 цифр) → добавить 7 (Казахстан/Россия)
      if (чистый.length === 10) {
        чистый = '7' + чистый;
      }

      const chatId = `${чистый}@c.us`;
      console.log(`Отправка на ${chatId}`);

      // Проверить что номер есть в WhatsApp
      const зарегистрирован = await клиент.isRegisteredUser(chatId);
      if (!зарегистрирован) {
        console.log(`${chatId} — не в WhatsApp, пропускаем`);
        continue;
      }

      await клиент.sendMessage(chatId, текст);
      успешно++;
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      console.error(`Ошибка на ${номер}:`, e.message);
    }
  }
  await рассылки.update({ _id: запись._id }, { $set: { успешно, статус: 'завершена' } });
});

router.get('/history', authMiddleware, async (req, res) => {
  const список = await рассылки.find({ userId: req.пользователь.id }).sort({ создана: -1 }).limit(50);
  res.json(список);
});

module.exports = router;
