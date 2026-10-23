import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { learningQuestions } from '../src/services/learningGame.js';

const cards = [
  { id: 'water', label: '물' },
  { id: 'rice', label: '밥' },
  { id: 'apple', label: '사과' },
  { id: 'milk', label: '우유' },
];

test('word-picture game creates the requested number of answerable questions', () => {
  const questions = learningQuestions(cards, 6, 3, 1, () => 0.25);

  assert.equal(questions.length, 6);
  for (const question of questions) {
    assert.equal(question.options.length, 3);
    assert.equal(new Set(question.options.map(card => card.id)).size, 3);
    assert.ok(question.options.some(card => card.id === question.target.id));
  }
});

test('word-picture game requires enough cards for every option', () => {
  assert.deepEqual(learningQuestions(cards.slice(0, 1), 5), []);
  assert.deepEqual(learningQuestions(cards.slice(0, 3), 5, 4), []);
});

test('difficulty controls option count and repeated target exposure', () => {
  const questions = learningQuestions(cards, 8, 4, 2, () => 0.25);

  assert.ok(questions.every(question => question.options.length === 4));
  const firstCycle = questions.slice(0, 4).map(question => question.target.id);
  const repeatedCycle = questions.slice(4, 8).map(question => question.target.id);
  assert.deepEqual(repeatedCycle, firstCycle);
});

test('play screen saves only a learning attempt and keeps communication available', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /request\('\/learning\/attempts'/);
  assert.match(app, /activity_type: snapshot\.activity_type \|\| 'word_picture_match'/);
  assert.match(app, /content_version: snapshot\.content_version/);
  assert.match(app, /items: snapshot\.results/);
  assert.match(app, /first_try_correct: !current\.hadWrong/);
  assert.match(app, /className="primary communication-return"/);
  assert.match(app, /괜찮아요\. 다른 단어를 다시 골라 보세요\./);
});
