const Datastore = require('nedb-promises');
const path = require('path');

const пользователи = Datastore.create({ filename: path.join(__dirname, 'data/users.db'), autoload: true });
const рассылки = Datastore.create({ filename: path.join(__dirname, 'data/sends.db'), autoload: true });

пользователи.ensureIndex({ fieldName: 'email', unique: true });

module.exports = { пользователи, рассылки };
