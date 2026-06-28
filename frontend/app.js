// ===== КОНФИГУРАЦИЯ =====
const API = 'https://whatsapp-blast-production-cdef.up.railway.app/api';

// ===== СОСТОЯНИЕ =====
let токен = localStorage.getItem('токен') || null;
let имяПользователя = localStorage.getItem('имя') || '';
let схемаNotion = [];         // все поля из Notion
let строкиТаблицы = [];       // текущие строки
let выбранныеId = new Set();  // выбранные строки (id Notion)
let выбранныеНомера = [];     // телефоны выбранных
let фильтры = [];             // активные фильтры
let сортировка = [];          // активная сортировка
let текущаяСортировкаКолонка = null;
let текущаяСортировкаНаправление = 'asc';
let опросWA = null;           // интервал опроса статуса WA

// ===== ИНИЦИАЛИЗАЦИЯ =====
window.onload = () => {
  if (токен) {
    показатьПриложение();
  }
};

// ===== АВТОРИЗАЦИЯ =====
function переключитьТаб(режим) {
  document.querySelectorAll('.таб').forEach(t => t.classList.remove('активный'));
  event.target.classList.add('активный');
  document.getElementById('форма-вход').style.display = режим === 'вход' ? 'block' : 'none';
  document.getElementById('форма-регистрация').style.display = режим === 'регистрация' ? 'block' : 'none';
  document.getElementById('auth-ошибка').textContent = '';
}

async function войти() {
  const email = document.getElementById('вход-email').value;
  const пароль = document.getElementById('вход-пароль').value;
  const ответ = await запрос('/auth/login', 'POST', { email, пароль });
  if (ответ.ошибка) return показатьОшибкуAuth(ответ.ошибка);
  сохранитьСессию(ответ.токен, ответ.имя);
}

async function зарегистрироваться() {
  const имя = document.getElementById('рег-имя').value;
  const email = document.getElementById('рег-email').value;
  const пароль = document.getElementById('рег-пароль').value;
  const ответ = await запрос('/auth/register', 'POST', { email, пароль, имя });
  if (ответ.ошибка) return показатьОшибкуAuth(ответ.ошибка);
  сохранитьСессию(ответ.токен, ответ.имя);
}

function сохранитьСессию(т, имя) {
  токен = т;
  имяПользователя = имя;
  localStorage.setItem('токен', т);
  localStorage.setItem('имя', имя);
  показатьПриложение();
}

function выйти() {
  токен = null;
  localStorage.removeItem('токен');
  localStorage.removeItem('имя');
  if (опросWA) clearInterval(опросWA);
  document.getElementById('экран-авторизации').style.display = 'flex';
  document.getElementById('экран-приложения').style.display = 'none';
}

function показатьОшибкуAuth(текст) {
  document.getElementById('auth-ошибка').textContent = текст;
}

function показатьПриложение() {
  document.getElementById('экран-авторизации').style.display = 'none';
  document.getElementById('экран-приложения').style.display = 'block';
  document.getElementById('имя-пользователя').textContent = имяПользователя;
  загрузитьНастройкиNotion();
  начатьОпросWA();
}

// ===== НАВИГАЦИЯ =====
function показатьВкладку(вкладка) {
  ['клиенты', 'рассылка', 'настройки'].forEach(в => {
    document.getElementById(`вкладка-${в}`).style.display = 'none';
  });
  document.getElementById(`вкладка-${вкладка}`).style.display = 'block';
  document.querySelectorAll('.нав-кнопка').forEach(к => к.classList.remove('активный'));
  event.target.classList.add('активный');

  if (вкладка === 'рассылка') {
    загрузитьИсторию();
    обновитьИнфоРассылки();
  }
  if (вкладка === 'клиенты' && схемаNotion.length === 0) {
    загрузитьСхему();
  }
}

// ===== NOTION — НАСТРОЙКИ =====
async function загрузитьНастройкиNotion() {
  const данные = await запрос('/notion/settings');
  if (данные.notion_токен) document.getElementById('notion-токен').value = данные.notion_токен;
  if (данные.notion_база) document.getElementById('notion-база').value = данные.notion_база;
  if (данные.notion_токен && данные.notion_база) загрузитьСхему();
}

async function сохранитьNotion() {
  const notion_токен = document.getElementById('notion-токен').value.trim();
  const notion_база = document.getElementById('notion-база').value.trim();
  const ответ = await запрос('/notion/settings', 'POST', { notion_токен, notion_база });
  if (ответ.успех) {
    показатьСтатусNotion('✅ Сохранено', true);
    загрузитьСхему();
  }
}

async function проверитьNotion() {
  const ответ = await запрос('/notion/schema');
  if (ответ.ошибка) return показатьСтатусNotion('❌ ' + ответ.ошибка, false);
  показатьСтатусNotion(`✅ Подключено: "${ответ.название}" (${ответ.свойства.length} полей)`, true);
}

function показатьСтатусNotion(текст, успех) {
  const эл = document.getElementById('notion-статус-текст');
  эл.textContent = текст;
  эл.className = 'статус-текст ' + (успех ? 'успех' : 'ошибка-текст');
}

// ===== NOTION — СХЕМА =====
async function загрузитьСхему() {
  const ответ = await запрос('/notion/schema');
  if (ответ.ошибка || !ответ.свойства) return;
  схемаNotion = ответ.свойства;
  загрузитьКлиентов();
}

// ===== NOTION — ДАННЫЕ =====
async function загрузитьКлиентов() {
  if (схемаNotion.length === 0) {
    document.getElementById('загрузка-таблицы').textContent = 'Сначала настройте Notion в настройках';
    return;
  }

  document.getElementById('загрузка-таблицы').style.display = 'block';
  document.getElementById('таблица-клиентов').style.display = 'none';
  document.getElementById('нет-данных').style.display = 'none';

  const активныеФильтры = фильтры
    .filter(ф => ф.поле && ф.оператор)
    .map(ф => ({ поле: ф.поле, тип: ф.тип, оператор: ф.оператор, значение: ф.значение }));

  const сорт = текущаяСортировкаКолонка ? [{
    поле: текущаяСортировкаКолонка,
    направление: текущаяСортировкаНаправление === 'asc' ? 'ascending' : 'descending'
  }] : [];

  const ответ = await запрос('/notion/query', 'POST', { фильтры: активныеФильтры, сортировка: сорт });

  document.getElementById('загрузка-таблицы').style.display = 'none';

  if (ответ.ошибка) {
    document.getElementById('нет-данных').textContent = 'Ошибка: ' + ответ.ошибка;
    document.getElementById('нет-данных').style.display = 'block';
    return;
  }

  строкиТаблицы = ответ.строки || [];
  document.getElementById('счётчик-строк').textContent = `${строкиТаблицы.length} записей`;

  if (строкиТаблицы.length === 0) {
    document.getElementById('нет-данных').style.display = 'block';
    return;
  }

  отрисоватьТаблицу();
}

function отрисоватьТаблицу() {
  const таблица = document.getElementById('таблица-клиентов');
  const заголовки = document.getElementById('заголовки-таблицы');
  const тело = document.getElementById('тело-таблицы');

  // Заголовки
  const колонки = схемаNotion.map(с => с.имя);
  заголовки.innerHTML = `
    <tr>
      <th class="чекбокс-ячейка"></th>
      ${колонки.map(к => `
        <th onclick="сортироватьПо('${к}')" class="${текущаяСортировкаКолонка === к ? (текущаяСортировкаНаправление === 'asc' ? 'сортировка-вверх' : 'сортировка-вниз') : ''}">
          ${к}
        </th>
      `).join('')}
    </tr>
  `;

  // Строки
  тело.innerHTML = строкиТаблицы.map(стр => {
    const выбрана = выбранныеId.has(стр.id);
    return `
      <tr class="${выбрана ? 'выбрана' : ''}" onclick="переключитьВыборСтроки('${стр.id}', event)">
        <td class="чекбокс-ячейка">
          <input type="checkbox" ${выбрана ? 'checked' : ''} onclick="event.stopPropagation(); переключитьВыборСтроки('${стр.id}', event)">
        </td>
        ${колонки.map(к => `<td title="${String(стр.ячейки[к] ?? '')}">${форматировать(стр.ячейки[к])}</td>`).join('')}
      </tr>
    `;
  }).join('');

  таблица.style.display = 'table';
  обновитьСчётчикВыбранных();
}

function форматировать(значение) {
  if (значение === null || значение === undefined || значение === '') return '<span style="color:#4a5568">—</span>';
  if (typeof значение === 'boolean') return значение ? '✅' : '☐';
  return String(значение);
}

function переключитьВыборСтроки(id, событие) {
  if (событие.target.tagName === 'INPUT') return; // обрабатывается отдельно
  if (выбранныеId.has(id)) выбранныеId.delete(id);
  else выбранныеId.add(id);
  обновитьВыделениеСтрок();
}

document.addEventListener('change', (e) => {
  if (e.target.closest('td.чекбокс-ячейка')) {
    const стр = e.target.closest('tr');
    const id = стр.querySelector('input[type=checkbox]');
    // найдём id строки
    const индекс = Array.from(document.querySelectorAll('#тело-таблицы tr')).indexOf(стр);
    if (индекс >= 0) {
      const строкаId = строкиТаблицы[индекс]?.id;
      if (строкаId) {
        if (e.target.checked) выбранныеId.add(строкаId);
        else выбранныеId.delete(строкаId);
        обновитьВыделениеСтрок();
      }
    }
  }
});

function обновитьВыделениеСтрок() {
  document.querySelectorAll('#тело-таблицы tr').forEach((стр, и) => {
    const строкаId = строкиТаблицы[и]?.id;
    const выбрана = строкаId && выбранныеId.has(строкаId);
    стр.classList.toggle('выбрана', выбрана);
    const чк = стр.querySelector('input[type=checkbox]');
    if (чк) чк.checked = выбрана;
  });
  обновитьСчётчикВыбранных();
}

function обновитьСчётчикВыбранных() {
  const кол = выбранныеId.size;
  document.getElementById('счётчик-выбранных').textContent = `${кол} выбрано`;
  document.getElementById('кнопка-разослать').disabled = кол === 0;

  // Собираем номера выбранных
  const полеТелефона = схемаNotion.find(с => с.тип === 'phone_number');
  if (полеТелефона) {
    выбранныеНомера = строкиТаблицы
      .filter(стр => выбранныеId.has(стр.id))
      .map(стр => стр.ячейки[полеТелефона.имя])
      .filter(н => н && String(н).trim());
  }
}

function выбратьВсех(нажато) {
  if (нажато) строкиТаблицы.forEach(стр => выбранныеId.add(стр.id));
  else выбранныеId.clear();
  обновитьВыделениеСтрок();
}

function сбросить() {
  выбранныеId.clear();
  фильтры = [];
  текущаяСортировкаКолонка = null;
  document.getElementById('зона-фильтров').innerHTML = '';
  document.getElementById('выбрать-всех').checked = false;
  загрузитьКлиентов();
}

function сортироватьПо(колонка) {
  if (текущаяСортировкаКолонка === колонка) {
    текущаяСортировкаНаправление = текущаяСортировкаНаправление === 'asc' ? 'desc' : 'asc';
  } else {
    текущаяСортировкаКолонка = колонка;
    текущаяСортировкаНаправление = 'asc';
  }
  загрузитьКлиентов();
}

// ===== ФИЛЬТРЫ =====
function добавитьФильтр() {
  const фильтр = { id: Date.now(), поле: '', тип: '', оператор: '', значение: '' };
  фильтры.push(фильтр);
  отрисоватьФильтры();
}

function отрисоватьФильтры() {
  const зона = document.getElementById('зона-фильтров');
  if (фильтры.length === 0) {
    зона.innerHTML = '<span style="color:#4a5568;font-size:13px">Нет фильтров — показываются все записи</span>';
    return;
  }
  зона.innerHTML = фильтры.map((ф, и) => `
    <div class="фильтр-строка" id="фильтр-${ф.id}">
      <select class="фильтр-select" onchange="изменитьПолеФильтра(${и}, this.value)">
        <option value="">— Поле —</option>
        ${схемаNotion.map(с => `<option value="${с.имя}" ${ф.поле === с.имя ? 'selected' : ''}>${с.имя}</option>`).join('')}
      </select>
      ${ф.поле ? операторыHTML(и, ф) : ''}
      ${ф.оператор && ф.оператор !== 'не_пусто' && ф.оператор !== 'сегодня' ? значениеHTML(и, ф) : ''}
      <button class="кнопка-удалить-фильтр" onclick="удалитьФильтр(${и})">✕</button>
    </div>
  `).join('');
}

function операторыHTML(и, ф) {
  const тип = схемаNotion.find(с => с.имя === ф.поле)?.тип || '';
  const операторы = операторыПоТипу(тип);
  return `<select class="фильтр-select" onchange="изменитьОператор(${и}, this.value)">
    <option value="">— Условие —</option>
    ${операторы.map(([знач, надпись]) => `<option value="${знач}" ${ф.оператор === знач ? 'selected' : ''}>${надпись}</option>`).join('')}
  </select>`;
}

function операторыПоТипу(тип) {
  if (тип === 'date') return [['сегодня', 'Сегодня'], ['равно', 'Равно (дата)'], ['после', 'После'], ['до', 'До']];
  if (тип === 'select') return [['равно', 'Равно'], ['не_равно', 'Не равно']];
  if (тип === 'multi_select') return [['содержит', 'Содержит']];
  if (тип === 'number') return [['равно', '='], ['больше', '>'], ['меньше', '<']];
  if (тип === 'checkbox') return [['равно', 'Равно']];
  if (тип === 'status') return [['равно', 'Равно']];
  return [['содержит', 'Содержит'], ['равно', 'Равно'], ['не_пусто', 'Не пусто']];
}

function значениеHTML(и, ф) {
  const схема = схемаNotion.find(с => с.имя === ф.поле);
  const тип = схема?.тип || '';
  const опции = схема?.опции || [];

  if (тип === 'date') return `<input type="date" class="фильтр-input" value="${ф.значение}" onchange="изменитьЗначение(${и}, this.value)">`;
  if ((тип === 'select' || тип === 'multi_select' || тип === 'status') && опции.length) {
    return `<select class="фильтр-select" onchange="изменитьЗначение(${и}, this.value)">
      <option value="">— Выберите —</option>
      ${опции.map(о => `<option value="${о.name}" ${ф.значение === о.name ? 'selected' : ''}>${о.name}</option>`).join('')}
    </select>`;
  }
  if (тип === 'checkbox') return `<select class="фильтр-select" onchange="изменитьЗначение(${и}, this.value)">
    <option value="true" ${ф.значение === 'true' ? 'selected' : ''}>Да</option>
    <option value="false" ${ф.значение === 'false' ? 'selected' : ''}>Нет</option>
  </select>`;
  return `<input type="text" class="фильтр-input" placeholder="Значение" value="${ф.значение}" oninput="изменитьЗначение(${и}, this.value)">`;
}

function изменитьПолеФильтра(и, поле) {
  const тип = схемаNotion.find(с => с.имя === поле)?.тип || '';
  фильтры[и] = { ...фильтры[и], поле, тип, оператор: '', значение: '' };
  отрисоватьФильтры();
}

function изменитьОператор(и, оператор) {
  фильтры[и].оператор = оператор;
  if (оператор === 'сегодня' || оператор === 'не_пусто') {
    фильтры[и].значение = '';
    загрузитьКлиентов();
  }
  отрисоватьФильтры();
}

function изменитьЗначение(и, значение) {
  фильтры[и].значение = значение;
  // Автоприменение через 600мс
  clearTimeout(фильтры[и]._таймер);
  фильтры[и]._таймер = setTimeout(загрузитьКлиентов, 600);
}

function удалитьФильтр(и) {
  фильтры.splice(и, 1);
  отрисоватьФильтры();
  загрузитьКлиентов();
}

// ===== WHATSAPP =====
function начатьОпросWA() {
  проверитьСтатусWA();
  опросWA = setInterval(проверитьСтатусWA, 8000);
}

async function проверитьСтатусWA() {
  const данные = await запрос('/whatsapp/status');
  const { статус, qr } = данные;

  const бейдж = document.getElementById('wa-статус-бейдж');
  const qrКонт = document.getElementById('qr-контейнер');
  const подключён = document.getElementById('wa-подключён');
  const неПодключён = document.getElementById('wa-не-подключён');
  const кнопкаОтключить = document.getElementById('кнопка-отключить-wa');

  if (статус === 'подключён') {
    бейдж.textContent = '● Подключён';
    бейдж.className = 'бейдж зелёный';
    qrКонт.style.display = 'none';
    подключён.style.display = 'block';
    неПодключён.style.display = 'none';
    кнопкаОтключить.style.display = 'block';
    document.getElementById('кнопка-переподключить-wa').style.display = 'block';
  } else if (статус === 'ожидание_qr' && qr) {
    бейдж.textContent = '● Ожидание QR';
    бейдж.className = 'бейдж жёлтый';
    qrКонт.style.display = 'block';
    document.getElementById('qr-код').src = qr;
    подключён.style.display = 'none';
    неПодключён.style.display = 'none';
    кнопкаОтключить.style.display = 'none';
  } else if (статус === 'инициализация') {
    бейдж.textContent = '● Загрузка...';
    бейдж.className = 'бейдж жёлтый';
  } else {
    бейдж.textContent = '● Не подключён';
    бейдж.className = 'бейдж серый';
    qrКонт.style.display = 'none';
    подключён.style.display = 'none';
    неПодключён.style.display = 'block';
    кнопкаОтключить.style.display = 'none';
  }
}

async function подключитьWA() {
  await запрос('/whatsapp/connect', 'POST');
}

async function отключитьWA() {
  if (!confirm('Отключить WhatsApp?')) return;
  await запрос('/whatsapp/disconnect', 'POST');
  проверитьСтатусWA();
}

async function переподключитьWA() {
  if (!confirm('Сбросить сессию и подключить заново? Нужно будет заново сканировать QR код.')) return;
  await запрос('/whatsapp/reconnect', 'POST');
  проверитьСтатусWA();
}

// ===== РАССЫЛКА =====
function перейтиКРассылке() {
  document.querySelectorAll('.нав-кнопка').forEach(к => к.classList.remove('активный'));
  document.querySelectorAll('.нав-кнопка')[1].classList.add('активный');
  показатьВкладку('рассылка');
}

function обновитьИнфоРассылки() {
  document.getElementById('инфо-кол-во').textContent = выбранныеНомера.length;
}

document.getElementById && (() => {
  const та = document.getElementById('текст-сообщения');
  if (та) та.addEventListener('input', () => {
    document.getElementById('кол-симв').textContent = та.value.length;
  });
})();

async function начатьРассылку() {
  const текст = document.getElementById('текст-сообщения').value.trim();
  if (!текст) return alert('Введите текст сообщения');
  if (!выбранныеНомера.length) return alert('Выберите получателей в таблице клиентов');

  const подтверждение = confirm(`Отправить сообщение ${выбранныеНомера.length} клиентам?`);
  if (!подтверждение) return;

  document.getElementById('кнопка-отправить').disabled = true;
  document.getElementById('прогресс-блок').style.display = 'block';
  document.getElementById('прогресс-текст').textContent = 'Запускаем рассылку...';

  const ответ = await запрос('/whatsapp/send', 'POST', { номера: выбранныеНомера, текст });

  if (ответ.ошибка) {
    alert('Ошибка: ' + ответ.ошибка);
    document.getElementById('кнопка-отправить').disabled = false;
    document.getElementById('прогресс-блок').style.display = 'none';
    return;
  }

  // Симуляция прогресса (настоящий прогресс — через polling в будущем)
  const всего = выбранныеНомера.length;
  let отправлено = 0;
  const интервал = setInterval(() => {
    отправлено = Math.min(отправлено + 1, всего);
    const процент = Math.round((отправлено / всего) * 100);
    document.getElementById('прогресс-заполнение').style.width = процент + '%';
    document.getElementById('прогресс-текст').textContent = `Отправлено: ${отправлено} из ${всего}`;
    if (отправлено >= всего) {
      clearInterval(интервал);
      document.getElementById('прогресс-текст').textContent = `✅ Рассылка завершена! Отправлено: ${всего}`;
      document.getElementById('кнопка-отправить').disabled = false;
      загрузитьИсторию();
    }
  }, 1500);
}

async function загрузитьИсторию() {
  const данные = await запрос('/whatsapp/history');
  const контейнер = document.getElementById('история-список');
  if (!данные.length) {
    контейнер.innerHTML = '<p class="загрузка-текст">История пуста</p>';
    return;
  }
  контейнер.innerHTML = данные.map(р => `
    <div class="история-карточка">
      <div class="история-заголовок">
        <span class="${р.статус === 'завершена' ? 'бейдж зелёный' : 'бейдж жёлтый'}">${р.статус}</span>
        <span class="история-дата">${новаяДата(р.создана)}</span>
      </div>
      <div class="история-текст">${р.текст}</div>
      <div class="история-стат">
        Отправлено: <b>${р.успешно}</b> из <b>${р.количество}</b>
      </div>
    </div>
  `).join('');
}

function новаяДата(строка) {
  return new Date(строка).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

// ===== HTTP ЗАПРОСЫ =====
async function запрос(путь, метод = 'GET', тело = null) {
  try {
    const опции = {
      method: метод,
      headers: { 'Content-Type': 'application/json' }
    };
    if (токен) опции.headers['Authorization'] = `Bearer ${токен}`;
    if (тело) опции.body = JSON.stringify(тело);
    const ответ = await fetch(API + путь, опции);
    return await ответ.json();
  } catch (e) {
    console.error('Ошибка запроса:', e);
    return { ошибка: 'Ошибка соединения с сервером' };
  }
}

// ===== ИНИЦИАЛИЗАЦИЯ ФИЛЬТРОВ =====
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('зона-фильтров').innerHTML =
    '<span style="color:#4a5568;font-size:13px">Нет фильтров — показываются все записи</span>';

  const та = document.getElementById('текст-сообщения');
  if (та) та.addEventListener('input', () => {
    document.getElementById('кол-симв').textContent = та.value.length;
  });
});
