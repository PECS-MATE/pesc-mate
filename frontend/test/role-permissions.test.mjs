import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

test('supporter navigation is derived from the selected link permissions', () => {
  assert.match(app, /selectedPermissions\.includes\('records_read'\)/);
  assert.match(app, /selectedPermissions\.includes\('notes_write'\)/);
  assert.match(app, /selectedPermissions\.includes\('voice_access_manage'\)/);
  assert.match(app, /canReadRecords && <button/);
  assert.match(app, /isSupporter && canWriteNotes/);
  assert.match(app, /canManageVoice && <button/);
});

test('support link grant, change and revoke use account-scoped APIs', () => {
  assert.match(app, /request\('\/support\/links'/);
  assert.match(app, /request\(`\/support\/links\/\$\{encodeURIComponent\(item\.supporter_id\)\}`/);
  assert.match(app, /method: 'PUT', body: JSON\.stringify\(\{ permissions \}\)/);
  assert.match(app, /method: 'DELETE'/);
});
