const fs = require('node:fs');

function readSecret(path, trimLineEndings = true) {
  if (!path || !path.startsWith('/')) throw new Error('Invalid MongoDB secret configuration');
  const data = fs.readFileSync(path);
  if (data.length > 1024 || [...data].some(byte => byte > 127)) throw new Error('Invalid MongoDB secret configuration');
  const value = data.toString('ascii');
  return trimLineEndings ? value.replace(/[\r\n]+$/, '') : value;
}

function readSettings() {
  const name = process.env.MONGO_INITDB_DATABASE || '';
  const username = readSecret(process.env.MONGODB_USERNAME_FILE);
  const password = readSecret(process.env.MONGODB_PASSWORD_FILE);
  if (!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$/.test(name) || ['admin', 'config', 'local'].includes(name.toLowerCase())
    || !/^[A-Za-z][A-Za-z0-9_-]{2,63}$/.test(username) || ['root', 'admin'].includes(username.toLowerCase())
    || !/^[!-~]{32,256}$/.test(password)) throw new Error('Invalid MongoDB application configuration');
  return { name, username, password };
}

module.exports = { readSecret, readSettings };
