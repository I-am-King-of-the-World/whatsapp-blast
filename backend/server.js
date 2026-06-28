require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Не давать серверу падать из-за ошибок Puppeteer/WhatsApp
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception (сервер продолжает работу):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection (сервер продолжает работу):', reason?.message || reason);
});

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/notion', require('./routes/notion'));
app.use('/api/whatsapp', require('./routes/whatsapp'));

app.get('/health', (req, res) => res.json({ статус: 'работает' }));

// Самопинг каждые 14 минут чтобы сервер не засыпал
setInterval(() => {
  const http = require('http');
  const url = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `http://${process.env.RAILWAY_PUBLIC_DOMAIN}/health`
    : `http://localhost:${process.env.PORT || 3001}/health`;
  http.get(url, () => {}).on('error', () => {});
}, 14 * 60 * 1000);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
