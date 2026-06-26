const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { пользователи } = require('../db');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'blast_secret_key';

router.post('/register', async (req, res) => {
  const { email, пароль, имя } = req.body;
  if (!email || !пароль || !имя) return res.status(400).json({ ошибка: 'Заполните все поля' });

  const хэш = await bcrypt.hash(пароль, 10);
  try {
    const юзер = await пользователи.insert({ email, пароль: хэш, имя, notion_токен: null, notion_база: null });
    const токен = jwt.sign({ id: юзер._id, email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ токен, имя });
  } catch {
    res.status(400).json({ ошибка: 'Email уже занят' });
  }
});

router.post('/login', async (req, res) => {
  const { email, пароль } = req.body;
  const юзер = await пользователи.findOne({ email });
  if (!юзер) return res.status(401).json({ ошибка: 'Неверный email или пароль' });

  const совпадает = await bcrypt.compare(пароль, юзер.пароль);
  if (!совпадает) return res.status(401).json({ ошибка: 'Неверный email или пароль' });

  const токен = jwt.sign({ id: юзер._id, email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ токен, имя: юзер.имя });
});

module.exports = router;
