import { shuffled } from './learningGame.js';

// Authored examples, not inferred intentions or AI-generated combinations.
// IDs refer to built-in concepts; private cards are never matched by filename/label.
export const SENTENCE_EXAMPLES = [
  { id: 'water-drink', card_ids: ['water', 'drink'], text: '물을 마셔요.' },
  { id: 'rice-eat', card_ids: ['rice', 'eat'], text: '밥을 먹어요.' },
  { id: 'apple-eat', card_ids: ['apple', 'eat'], text: '사과를 먹어요.' },
  { id: 'snack-eat', card_ids: ['snack', 'eat'], text: '간식을 먹어요.' },
  { id: 'toilet-go', card_ids: ['toilet', 'go'], text: '화장실에 가요.' },
  { id: 'me-rest', card_ids: ['me', 'rest'], text: '저는 쉬어요.' },
  { id: 'me-water-drink', card_ids: ['me', 'water', 'drink'], text: '저는 물을 마셔요.' },
  { id: 'me-rice-eat', card_ids: ['me', 'rice', 'eat'], text: '저는 밥을 먹어요.' },
  { id: 'me-apple-eat', card_ids: ['me', 'apple', 'eat'], text: '저는 사과를 먹어요.' },
  { id: 'me-toilet-go', card_ids: ['me', 'toilet', 'go'], text: '저는 화장실에 가요.' },
];

export function availableSentenceExamples(cards) {
  const ids = new Set(cards.map(card => card.id));
  return SENTENCE_EXAMPLES.filter(example => example.card_ids.every(id => ids.has(id)));
}

export function sentenceLearningQuestions(cards, count, repeatFrequency = 1, random = Math.random, exampleId = null) {
  const examples = availableSentenceExamples(cards).filter(example => !exampleId || example.id === exampleId);
  if (!examples.length || !Number.isInteger(count) || count < 1 || count > 30) return [];
  const byId = new Map(cards.map(card => [card.id, card]));
  const targets = [];
  const repeats = Math.min(3, Math.max(1, Math.trunc(repeatFrequency) || 1));
  while (targets.length < count) {
    const cycle = shuffled(examples, random);
    for (let repeat = 0; repeat < repeats; repeat += 1) targets.push(...cycle);
  }
  return targets.slice(0, count).map(example => {
    const sequence = example.card_ids.map(id => byId.get(id));
    let options = shuffled(sequence, random);
    // Do not accidentally present every choice in the solution order.
    if (options.every((card, index) => card.id === sequence[index].id)) options = [...options.slice(1), options[0]];
    return { content_id: example.id, prompt: example.text, sequence, target: sequence.at(-1), options };
  });
}

export function validSentenceQuestion(question) {
  const example = SENTENCE_EXAMPLES.find(item => item.id === question?.content_id);
  return Boolean(example && question.prompt === example.text && question.target?.id === example.card_ids.at(-1)
    && Array.isArray(question.sequence) && question.sequence.length === example.card_ids.length
    && question.sequence.every((card, index) => card?.id === example.card_ids[index])
    && Array.isArray(question.options) && question.options.length === example.card_ids.length
    && new Set(question.options.map(card => card?.id)).size === example.card_ids.length
    && question.options.every(card => example.card_ids.includes(card?.id)));
}

export function validSentenceDraft(question, ids) {
  return Array.isArray(question?.sequence) && Array.isArray(ids) && ids.length <= question.sequence.length
    && new Set(ids).size === ids.length && ids.every(id => question.sequence.some(card => card.id === id));
}

export function sentenceOrderMatches(question, ids) {
  return validSentenceDraft(question, ids) && ids.length === question.sequence.length
    && ids.every((id, index) => id === question.sequence[index].id);
}
