const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { рассылки } = require('../db');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

const клиенты = new Map();   // userId -> Client
const статусы = new Map();   // userId -> { статус, qr }

function создатьКлиент(userId) {
  if (клиенты.has(userId)) {
    try { клиенты.get(userId).destroy(); } catch {}
    клиенты.delete(userId);
  }

  статусы.set(userId, { статус: 'инициализация', qr: null });

  const клиент = new Client({
    authStrategy: new LocalAuth({ clientId: `user_${userId}`, dataPath: './sessions' }),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] }
  });

  клиент.on('qr', async (qr) => {
    статусы.set(userId, { статус: 'ожидание_qr', qr: await qrcode.toDataURL(qr) });
  });
  клиент.on('ready', () => статусы.set(userId, { статус: 'подключён', qr: null }));
  клиент.on('disconnected', () => { статусы.set(userId, { статус: 'отключён', qr: null }); клиенты.delete(userId); });
  клиент.on('auth_failure', () => { статусы.set(userId, { статус: 'ошибка_авторизации', qr: null }); клиенты.delete(userId); });

  клиент.initialize();
  клиенты.set(userId, клиент);
}

router.post('/connect', authMiddleware, (req, res) => {
  создатьКлиент(req.пользователь.id);
  res.json({ сообщение: 'Инициализация начата' });
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
      const чистый = номер.replace(/\D/g, '');
      if (чистый.length < 10) continue;
      await клиент.sendMessage(`${чистый}@c.us`, текст);
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
