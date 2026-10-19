try {
  const { readSettings } = require('/opt/pesc-mate/mongodb/config.cjs');
  const { name, username, password } = readSettings();
  const application = db.getSiblingDB(name);
  if (!application.auth({ user: username, pwd: password, mechanism: 'SCRAM-SHA-256' })) quit(1);
  if (application.runCommand({ ping: 1 }).ok !== 1) quit(1);
} catch {
  print('Authenticated MongoDB health check failed.');
  quit(1);
}
