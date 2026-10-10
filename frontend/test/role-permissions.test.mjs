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
  assert.match(app, /canManageQuick \|\| canManageBoard/);
});

test('configured quick expressions and slots stay separate from recommendations', () => {
  assert.match(app, /boardLayout\.quick_expression_ids\.map/);
  assert.match(app, /boardLayout\.slots\.map/);
  assert.match(app, /tab === 'cards' \? configuredBoardCards : cards/);
  assert.match(app, /request\(`\/board\/layout\/\$\{path\}\$\{query\}`/);
});

test('recovery expressions have a fixed user area and supporter configuration', () => {
  assert.match(app, /className="recovery-speech"/);
  assert.match(app, /boardLayout\?\.recovery_expression_ids/);
  assert.match(app, /recovery-expressions/);
  assert.match(app, /speakText\(item\.label, 'recovery', true\)/);
  assert.match(app, /마지막 말 다시 듣기/);
  assert.match(app, /현재 문장 취소/);
  assert.match(app, /직전 문장 불러오기/);
  assert.match(app, /function restoreLastSentence\(\)/);
});

test('support link grant, change and revoke use account-scoped APIs', () => {
  assert.match(app, /request\('\/support\/links'/);
  assert.match(app, /request\(`\/support\/links\/\$\{encodeURIComponent\(item\.supporter_id\)\}`/);
  assert.match(app, /method: 'PUT', body: JSON\.stringify\(\{ permissions \}\)/);
  assert.match(app, /method: 'DELETE'/);
});

test('content operations are an account permission on support staff', () => {
  assert.match(app, /user\?\.role === 'support_staff' && user\?\.account_permissions\?\.includes\('content_manage'\)/);
  assert.match(app, /canManageContent && <button/);
  assert.match(app, /tab === 'admin' && canManageContent/);
  assert.doesNotMatch(app, /user\.role === 'admin'/);
});
