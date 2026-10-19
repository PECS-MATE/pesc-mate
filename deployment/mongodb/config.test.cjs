const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const application = { name: 'synthetic_db', username: 'synthetic_app', password: 'app-password-' + 'x'.repeat(40) };
function loadConfig(files, env) {
  const module = { exports: {} };
  vm.runInNewContext(source('config.cjs'), {
    module, process: { env }, require: () => ({ readFileSync: file => {
      if (!(file in files)) throw new Error('private-file-error');
      return Buffer.from(files[file]);
    } }),
  });
  return module.exports;
}
function runScript(file, rootUsername = 'synthetic_manager', rootPassword = 'root-password-' + 'x'.repeat(40), failAuth = false) {
  const events = { created: [], messages: [], exit: 0 };
  const files = { '/root-user': rootUsername, '/root-password': rootPassword };
  const config = loadConfig(files, {});
  const settings = { readSettings: () => application, readSecret: (file, trim) =>
    config.readSecret(file.endsWith('username') ? '/root-user' : '/root-password', trim) };
  const db = { getSiblingDB: name => ({
    createUser: user => events.created.push({ name, user: JSON.parse(JSON.stringify(user)) }),
    auth: () => { if (failAuth) throw new Error('private-password-or-error'); return true; },
    runCommand: () => ({ ok: 1 }),
  }) };
  try {
    vm.runInNewContext(source(file), { require: () => settings, db,
      print: message => events.messages.push(message), quit: code => { events.exit = code; throw new Error('synthetic-exit'); } });
  } catch (error) { assert.equal(error.message, 'synthetic-exit'); }
  return events;
}

test('application secrets normalize final CRLF while admin readers can require exact bytes', () => {
  const config = loadConfig({ '/user': 'synthetic_app\r\n', '/password': application.password + '\r\n' }, {
    MONGO_INITDB_DATABASE: application.name, MONGODB_USERNAME_FILE: '/user', MONGODB_PASSWORD_FILE: '/password',
  });
  assert.equal(config.readSettings().password, application.password);
  assert.equal(config.readSecret('/user', false), 'synthetic_app\r\n');
});

test('initialization creates only the exact application database readWrite role with SCRAM-SHA-256', () => {
  const events = runScript('init-app.js');
  assert.equal(events.exit, 0);
  assert.deepEqual(events.created, [{ name: application.name, user: { user: application.username, pwd: application.password,
    roles: [{ role: 'readWrite', db: application.name }], mechanisms: ['SCRAM-SHA-256'] } }]);
  assert.ok(events.messages.every(message => !message.includes(application.password)));
});

test('invalid or reused administrator credentials stop application initialization without printing secrets', () => {
  for (const [username, password] of [
    ['synthetic_manager', 'short-password'], ['synthetic_manager', application.password],
    [application.username, 'root-password-' + 'x'.repeat(40)],
    ['synthetic_manager\r\n', 'root-password-' + 'x'.repeat(40)],
    ['synthetic_manager', 'root-password-' + 'x'.repeat(40) + '\r\n'],
  ]) {
    const events = runScript('init-app.js', username, password);
    assert.equal(events.exit, 1);
    assert.deepEqual(events.created, []);
    assert.ok(events.messages.every(message => !message.includes(password)));
  }
});

test('health check requires authentication and hides raw authentication errors', () => {
  assert.equal(runScript('healthcheck.js').exit, 0);
  const events = runScript('healthcheck.js', undefined, undefined, true);
  assert.equal(events.exit, 1);
  assert.ok(events.messages.every(message => !message.includes('private-password')));
});
