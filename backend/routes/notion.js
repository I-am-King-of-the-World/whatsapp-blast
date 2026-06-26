const express = require('express');
const axios = require('axios');
const { пользователи } = require('../db');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

router.post('/settings', authMiddleware, async (req, res) => {
  const { notion_токен, notion_база } = req.body;
  await пользователи.update({ _id: req.пользователь.id }, { $set: { notion_токен, notion_база } });
  res.json({ успех: true });
});

router.get('/settings', authMiddleware, async (req, res) => {
  const п = await пользователи.findOne({ _id: req.пользователь.id });
  res.json({ notion_токен: п?.notion_токен, notion_база: п?.notion_база });
});

router.get('/schema', authMiddleware, async (req, res) => {
  const п = await пользователи.findOne({ _id: req.пользователь.id });
  if (!п?.notion_токен) return res.status(400).json({ ошибка: 'Notion не настроен' });

  try {
    const ответ = await axios.get(`https://api.notion.com/v1/databases/${п.notion_база}`, {
      headers: { 'Authorization': `Bearer ${п.notion_токен}`, 'Notion-Version': '2022-06-28' }
    });
    const свойства = Object.entries(ответ.data.properties).map(([имя, данные]) => ({
      имя,
      тип: данные.type,
      опции: данные.select?.options || данные.multi_select?.options || данные.status?.options || []
    }));
    res.json({ свойства, название: ответ.data.title?.[0]?.plain_text });
  } catch (e) {
    res.status(400).json({ ошибка: 'Ошибка подключения к Notion', детали: e.response?.data });
  }
});

router.post('/query', authMiddleware, async (req, res) => {
  const п = await пользователи.findOne({ _id: req.пользователь.id });
  if (!п?.notion_токен) return res.status(400).json({ ошибка: 'Notion не настроен' });

  const { фильтры, сортировка, курсор } = req.body;

  let filter = undefined;
  if (фильтры?.length) {
    const условия = фильтры.map(ф => построитьФильтр(ф)).filter(Boolean);
    if (условия.length === 1) filter = условия[0];
    else if (условия.length > 1) filter = { and: условия };
  }

  const тело = { page_size: 100 };
  if (filter) тело.filter = filter;
  if (курсор) тело.start_cursor = курсор;
  if (сортировка?.length) тело.sorts = сортировка.map(с => ({ property: с.поле, direction: с.направление || 'ascending' }));

  try {
    const ответ = await axios.post(
      `https://api.notion.com/v1/databases/${п.notion_база}/query`,
      тело,
      { headers: { 'Authorization': `Bearer ${п.notion_токен}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' } }
    );
    const строки = ответ.data.results.map(стр => {
      const ячейки = {};
      for (const [ключ, знач] of Object.entries(стр.properties)) ячейки[ключ] = извлечьЗначение(знач);
      return { id: стр.id, ячейки };
    });
    res.json({ строки, следующий_курсор: ответ.data.next_cursor, есть_ещё: ответ.data.has_more });
  } catch (e) {
    res.status(400).json({ ошибка: 'Ошибка запроса Notion', детали: e.response?.data });
  }
});

function построитьФильтр(ф) {
  const { поле, тип, оператор, значение } = ф;
  if (!поле || !оператор) return null;
  if (тип === 'date') {
    const сегодня = new Date().toISOString().split('T')[0];
    if (оператор === 'сегодня') return { property: поле, date: { equals: сегодня } };
    if (оператор === 'равно') return { property: поле, date: { equals: значение } };
    if (оператор === 'после') return { property: поле, date: { after: значение } };
    if (оператор === 'до') return { property: поле, date: { before: значение } };
  }
  if (тип === 'select') {
    if (оператор === 'равно') return { property: поле, select: { equals: значение } };
    if (оператор === 'не_равно') return { property: поле, select: { does_not_equal: значение } };
  }
  if (тип === 'multi_select') {
    if (оператор === 'содержит') return { property: поле, multi_select: { contains: значение } };
  }
  if (тип === 'number') {
    if (оператор === 'равно') return { property: поле, number: { equals: Number(значение) } };
    if (оператор === 'больше') return { property: поле, number: { greater_than: Number(значение) } };
    if (оператор === 'меньше') return { property: поле, number: { less_than: Number(значение) } };
  }
  if (тип === 'checkbox') return { property: поле, checkbox: { equals: значение === 'true' } };
  if (тип === 'status') {
    if (оператор === 'равно') return { property: поле, status: { equals: значение } };
  }
  // text, phone_number, title, rich_text
  if (оператор === 'содержит') return { property: поле, rich_text: { contains: значение } };
  if (оператор === 'равно') return { property: поле, rich_text: { equals: значение } };
  if (оператор === 'не_пусто') return { property: поле, rich_text: { is_not_empty: true } };
  return null;
}

function извлечьЗначение(prop) {
  switch (prop.type) {
    case 'title': return prop.title.map(t => t.plain_text).join('');
    case 'rich_text': return prop.rich_text.map(t => t.plain_text).join('');
    case 'phone_number': return prop.phone_number || '';
    case 'number': return prop.number;
    case 'select': return prop.select?.name || '';
    case 'multi_select': return prop.multi_select.map(s => s.name).join(', ');
    case 'date': return prop.date?.start || '';
    case 'checkbox': return prop.checkbox;
    case 'email': return prop.email || '';
    case 'url': return prop.url || '';
    case 'status': return prop.status?.name || '';
    case 'created_time': return prop.created_time;
    case 'last_edited_time': return prop.last_edited_time;
    case 'formula': return prop.formula?.string || prop.formula?.number || '';
    default: return '';
  }
}

module.exports = router;
