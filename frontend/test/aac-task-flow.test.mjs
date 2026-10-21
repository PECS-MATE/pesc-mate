import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');

test('AAC user can find an expression by search, category, and card list', () => {
  assert.match(app, /aria-label="카드 검색"/);
  assert.match(app, /aria-label="카테고리" data-scan-group="categories"/);
  assert.match(app, /visibleCards\.map\(tile\)/);
  const tile = app.slice(app.indexOf('function tile('), app.indexOf('const layoutCards ='));
  assert.match(tile, /if \(speakOnTap\) speakText\(card\.label, 'card', \[card\.id\]\); else add\(card\)/);
  assert.doesNotMatch(tile, /\bawait\b/); // Recommendation telemetry must never delay speaking/selection.
});

test('AAC user can build a sentence without losing the selected card order', () => {
  assert.match(app, /if \(board\.length >= 12\)/);
  assert.match(app, /cards: board\.map\(c => c\.id\)/);
  assert.match(app, /<small>선택한 카드 순서<\/small>/);
  assert.match(app, /board\.map\(\(card, index\) => <span/);
  assert.match(app, /문장 생성 없이도 말할 수 있어요/);
});

test('AAC user confirms and controls speech explicitly', () => {
  assert.match(app, /setSentenceConfirmed\(true\)/);
  assert.match(app, /function speak\(\) \{ if \(sentenceConfirmed\)/);
  assert.match(app, /확인한 문장 읽기/);
  assert.match(app, /onClick=\{pauseSpeech\}>일시 정지/);
  assert.match(app, /onClick=\{stopSpeech\}>중지/);
});

test('AAC user can correct card order, remove mistakes, and regenerate', () => {
  assert.match(app, /aria-label=\{`\$\{i \+ 1\}번째 카드 앞으로`\}/);
  assert.match(app, /aria-label=\{`\$\{i \+ 1\}번째 카드 뒤로`\}/);
  assert.match(app, /aria-label=\{`\$\{i \+ 1\}번째 카드 삭제`\}/);
  assert.match(app, /선택한 카드를 모두 지울까요/);
  assert.match(app, /onClick=\{regenerate\}/);
  assert.match(app, /현재 문장 취소/);
});

test('urgent and recovery speech remain available around the task flow', () => {
  assert.match(app, /\{ id: 'help', label: '도와주세요'/);
  assert.match(app, /data-scan-group="quick-speech"/);
  assert.match(app, /data-scan-group="recovery-speech"/);
  assert.match(app, /마지막 말 다시 듣기/);
});

test('essential recovery phrases stay fixed and failed speech keeps visible text', () => {
  assert.match(app, /label: '잘못 눌렀어요'.*fixed: true/);
  assert.match(app, /label: '그 뜻이 아니에요'.*fixed: true/);
  assert.match(app, /label: '잠깐만요'/);
  assert.match(app, /disabled=\{item\?\.fixed \|\| recoveryDraft\.length <= 2\}/);
  assert.match(app, /전달할 표현: <strong>\{speechFailure\.content\}<\/strong>/);
});
