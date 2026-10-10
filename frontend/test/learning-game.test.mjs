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
  const questions = learningQuestions(cards, 6, () => 0.25);

  assert.equal(questions.length, 6);
  for (const question of questions) {
    assert.equal(question.options.length, 3);
    assert.equal(new Set(question.options.map(card => card.id)).size, 3);
    assert.ok(question.options.some(card => card.id === question.target.id));
  }
});

test('word-picture game requires at least two picture cards', () => {
  assert.deepEqual(learningQuestions(cards.slice(0, 1), 5), []);
});

test('play screen saves only a learning attempt and keeps communication available', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /request\('\/learning\/attempts'/);
  assert.match(app, /activity_type: 'word_picture_match'/);
  assert.match(app, /className="primary communication-return"/);
  assert.match(app, /괜찮아요\. 다른 단어를 다시 골라 보세요\./);
});
