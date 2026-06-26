require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/notion', require('./routes/notion'));
app.use('/api/whatsapp', require('./routes/whatsapp'));

app.get('/health', (req, res) => res.json({ статус: 'работает' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
