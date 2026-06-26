const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'blast_secret_key';

module.exports = (req, res, next) => {
  const заголовок = req.headers.authorization;
  if (!заголовок) return res.status(401).json({ ошибка: 'Нет токена' });

  const токен = заголовок.split(' ')[1];
  try {
    req.пользователь = jwt.verify(токен, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ ошибка: 'Недействительный токен' });
  }
};
