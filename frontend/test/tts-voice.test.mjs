import assert from 'node:assert/strict';
import test from 'node:test';

import { localKoreanVoices, selectTtsVoice } from '../src/services/ttsVoice.js';

const local = { name: '기기 음성', lang: 'ko-KR', localService: true };
const remote = { name: '온라인 음성', lang: 'ko-KR', localService: false };
const unknown = { name: '확인 필요', lang: 'ko-KR' };

test('offline speech replaces a selected remote voice with a local voice', () => {
  assert.equal(selectTtsVoice([remote, local], remote.name, true), local);
});

test('offline speech never forces a known remote-only voice', () => {
  assert.equal(selectTtsVoice([remote], remote.name, true), null);
  assert.equal(selectTtsVoice([unknown], unknown.name, true), unknown);
});

test('local readiness only counts voices explicitly stored on the device', () => {
  assert.deepEqual(localKoreanVoices([remote, unknown, local]), [local]);
});
