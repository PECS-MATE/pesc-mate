import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const api = await readFile(new URL('../src/services/api.js', import.meta.url), 'utf8');

test('supporter card management stays scoped to the selected linked user', () => {
  assert.match(app, /canManageCards = selectedPermissions\.includes\('cards_manage'\)/);
  assert.match(app, /request\(`\/cards\/submissions\?user_id=\$\{encodeURIComponent\(target\.id\)\}`\)/);
  assert.match(app, /formData\.set\('user_id', selectedUser\.id\)/);
  assert.match(app, /tab === 'card_settings' && isSupporter && canManageCards/);
  assert.match(app, /개인 카드는 연결 사용자에게만 표시/);
});

test('supporter can fix card positions and quick expressions independently', () => {
  assert.match(app, /canManageQuick = selectedPermissions\.includes\('quick_speech_manage'\)/);
  assert.match(app, /canManageBoard = selectedPermissions\.includes\('board_manage'\)/);
  assert.match(app, /saveBoardConfiguration\('quick'\)/);
  assert.match(app, /saveBoardConfiguration\('slots'\)/);
  assert.match(app, /빠른 표현 저장/);
  assert.match(app, /카드판 저장/);
});

test('supporter learning settings target only a linked user with permission', () => {
  assert.match(app, /canManageLearning = selectedPermissions\.includes\('learning_manage'\)/);
  assert.match(app, /request\(`\/learning\/settings\$\{query\}`/);
  assert.match(app, /query = `\?user_id=\$\{encodeURIComponent\(selectedUser\.id\)\}`/);
  assert.match(app, /학습 설정 저장/);
});

test('supporter child data is cleared and never cached for offline access', () => {
  assert.match(app, /async function cacheAccountForOffline\(account, expiresAt\)/);
  assert.match(app, /if \(account\?\.role === 'user'\) return cacheAccount\(account, expiresAt\)/);
  assert.match(app, /function clearSupportTargetData\(\)/);
  assert.match(app, /if \(\['caregiver', 'support_staff'\]\.includes\(user\?\.role\)\)/);
  assert.match(app, /보호자·담당자용 사용자 정보는 오프라인에서 보관하지 않습니다/);
  assert.match(api, /status === 403/);
  assert.match(api, /pesc-mate:access-denied/);
  assert.match(app, /지원 권한이 변경되어 사용자 정보를 닫았습니다/);
});
