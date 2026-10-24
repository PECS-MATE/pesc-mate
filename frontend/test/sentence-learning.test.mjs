import assert from 'node:assert/strict';
import test from 'node:test';
import { availableSentenceExamples, sentenceLearningQuestions, sentenceOrderMatches,
  validSentenceDraft, validSentenceQuestion } from '../src/services/sentenceLearning.js';

const cards = ['me', 'water', 'drink', 'rice', 'eat'].map(id => ({ id, label: id }));

test('문장 예문은 사용 가능한 개념만 쓰고 무작위 조합이나 같은 이름의 개인 카드를 추측하지 않는다', () => {
  assert.equal(availableSentenceExamples([{ id: 'private-water', label: '물' }, { id: 'drink' }]).length, 0);
  assert.deepEqual(sentenceLearningQuestions(cards.filter(card => card.id === 'water'), 5), []);
  const questions = sentenceLearningQuestions(cards, 8, 1, () => 0.25);
  assert.equal(questions.length, 8);
  for (const question of questions) {
    assert.ok(validSentenceQuestion(question));
    assert.ok(question.sequence.every(card => cards.includes(card)));
    assert.equal(question.options.length, question.sequence.length);
    assert.ok(!sentenceOrderMatches(question, question.options.map(card => card.id)));
  }
});

test('문제 수와 예문 반복을 유지하고 지원하지 않는 문제 수를 거절한다', () => {
  const questions = sentenceLearningQuestions(cards, 8, 2, () => 0.25);
  assert.deepEqual(questions.slice(0, 4).map(q => q.content_id), questions.slice(4, 8).map(q => q.content_id));
  for (const count of [0, -1, 31, 1.5, NaN]) assert.deepEqual(sentenceLearningQuestions(cards, count), []);
});

test('순서는 정확한 카드 ID로 검사하고 중복·누락·외부 카드를 정답으로 인정하지 않는다', () => {
  const [question] = sentenceLearningQuestions(cards, 1, 1, () => 0.25);
  const answer = question.sequence.map(card => card.id);
  assert.ok(sentenceOrderMatches(question, answer));
  assert.ok(!sentenceOrderMatches(question, answer.toReversed()));
  assert.ok(!sentenceOrderMatches(question, answer.slice(1)));
  assert.ok(!validSentenceDraft(question, [answer[0], answer[0]]));
  assert.ok(!validSentenceDraft(question, ['another-child-private-card']));
  assert.ok(!validSentenceDraft(undefined, []));
});

test('재개 콘텐츠는 예문 ID·문장·정답 순서와 선택지 집합까지 대조한다', () => {
  const [question] = sentenceLearningQuestions(cards, 1, 1, () => 0.25);
  assert.ok(validSentenceQuestion(question));
  assert.ok(!validSentenceQuestion({ ...question, prompt: '다른 문장' }));
  assert.ok(!validSentenceQuestion({ ...question, content_id: 'future-version-example' }));
  assert.ok(!validSentenceQuestion({ ...question, sequence: question.sequence.toReversed() }));
  assert.ok(!validSentenceQuestion({ ...question, options: [question.target, question.target] }));
  assert.ok(!validSentenceQuestion({ ...question, sequence: { length: question.sequence.length } }));
  assert.ok(!validSentenceQuestion({ ...question, options: { length: question.options.length } }));
});
