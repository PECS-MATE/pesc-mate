// Official Mongo image executes this ONLY for a fresh data directory.
try {
  const { readSecret, readSettings } = require('/opt/pesc-mate/mongodb/config.cjs');
  const { name, username, password } = readSettings();
  // The image's shell entrypoint does not normalize CRLF like the application reader.
  const rootUsername = readSecret('/run/secrets/mongodb_root_username', false);
  const rootPassword = readSecret('/run/secrets/mongodb_root_password', false);
  if (!/^[A-Za-z][A-Za-z0-9_-]{2,63}$/.test(rootUsername) || !/^[!-~]{32,256}$/.test(rootPassword)
    || username === rootUsername || password === rootPassword) throw new Error('Credentials must be valid and distinct');
  db.getSiblingDB(name).createUser({ user: username, pwd: password,
    roles: [{ role: 'readWrite', db: name }], mechanisms: ['SCRAM-SHA-256'] });
  print('Application database user initialized.');
} catch {
  print('Application database initialization failed. Check the approved secret/configuration files.');
  quit(1);
}
