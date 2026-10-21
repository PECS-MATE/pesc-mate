import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

test('AAC home limits primary choices to speaking and practice', () => {
  const primary = app.match(/<div className="home-mode-grid"[\s\S]*?<\/div>\s*<nav className="home-secondary-actions"/)?.[0] || '';
  assert.match(primary, /<strong>말하기<\/strong>/);
  assert.match(primary, /<strong>연습하기<\/strong>/);
  assert.equal((primary.match(/home-launch-card/g) || []).length, 2);
  assert.match(app, /home-secondary-actions/);
});

test('urgent speech remains outside home and practice screen routing', () => {
  assert.ok(app.indexOf('className="quick-speech"') < app.indexOf('className="support-home"'));
  assert.match(app, /communication-return/);
  assert.match(app, /말하기와 빠른 표현은 계속 사용할 수 있습니다/);
});

test('learning achievement navigation requires the linked permission', () => {
  assert.match(app, /canManageLearning = selectedPermissions\.includes\('learning_manage'\)/);
  assert.match(app, /canManageLearning && <button/);
  assert.match(app, /openLearning\(selectedUser\)/);
  assert.match(app, /linkedUsers\.filter\(person => person\.permissions\.includes\('learning_manage'\)\)/);
  assert.match(app, /request\(`\/learning\/progress/);
});

test('learning manager can save difficulty and repetition settings', () => {
  assert.match(app, /saveLearningConfiguration/);
  assert.match(app, /option_count: Number\(learningSettings\.option_count\)/);
  assert.match(app, /repeat_frequency: Number\(learningSettings\.repeat_frequency\)/);
  assert.match(app, /request\(`\/learning\/settings\$\{query\}`/);
  assert.match(app, /단어 보기 수/);
  assert.match(app, /카드 반복/);
});

test('learning progress prioritizes participation and word familiarity', () => {
  assert.match(app, /참여 횟수/);
  assert.match(app, /반복해서 만나본 단어/);
  assert.doesNotMatch(app, /익숙해진 단어|번 어려웠어요/);
  assert.match(app, /다시 만나볼 단어/);
  assert.match(app, /learningProgress\.repeat_words/);
  assert.doesNotMatch(app, /<span>평균 점수<\/span>/);
});
