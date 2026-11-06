import { shuffled } from './learningGame.js';

export const SITUATIONS = { meal: '식사', school: '학교', outing: '외출' };
const SCENARIOS = {
  meal: [
    ['thirst', '목이 말라 마실 물을 부탁하고 싶어요.', ['water']],
    ['food', '배가 고파 밥을 부탁하고 싶어요.', ['rice']],
    ['finished', '먹는 것을 그만하고 싶어요.', ['stop', 'finished']],
  ],
  school: [
    ['help', '어려운 일이 있어 도움을 부탁하고 싶어요.', ['help']],
    ['rest', '잠시 쉬고 싶다는 말을 전하고 싶어요.', ['rest', 'want_rest']],
    ['toilet', '화장실에 가고 싶어요.', ['toilet']],
  ],
  outing: [
    ['home', '밖에서 놀다가 집에 가고 싶어요.', ['home']],
    ['wait', '함께 가는 사람이 잠시 기다려 주면 좋겠어요.', ['wait', 'hold_on']],
    ['water', '산책하다 목이 말라 물을 부탁하고 싶어요.', ['water']],
  ],
};

export function situationQuestions(cards, count = 5, optionCount = 3, situation = 'meal', random = Math.random) {
  const unique = [...new Map(cards.map(card => [card.id, card])).values()];
  const scenarios = (SCENARIOS[situation] || []).map(([id, prompt, ids]) => ({
    id, prompt, answers: unique.filter(card => ids.includes(card.id)),
  })).filter(row => row.answers.length);
  if (!scenarios.length || unique.length < optionCount) return [];
  return Array.from({ length: count }, (_, index) => {
    const scenario = scenarios[index % scenarios.length];
    const target = scenario.answers[0];
    return { target, prompt: scenario.prompt, situation, scenario_id: scenario.id,
      answer_ids: scenario.answers.map(card => card.id),
      options: shuffled([target, ...shuffled(unique.filter(c => c.id !== target.id), random).slice(0, optionCount - 1)], random) };
  });
}

export function programEntries(program, attempts = []) {
  if (!program) return { today: null, reviews: [], day: 0 };
  const today = program.today || new Date().toLocaleDateString('sv-SE');
  const elapsed = Math.floor((Date.parse(today) - Date.parse(program.starts_on)) / 86400000);
  const byId = new Map(program.sets.map(row => [row.id, row]));
  const todaySet = elapsed >= 0 && elapsed < 30 && program.daily_set_ids.length
    ? byId.get(program.daily_set_ids[elapsed % program.daily_set_ids.length]) : null;
  const reviews = program.sets.filter(row => {
    const recent = attempts.filter(item => item.program_set_id === row.id)
      .sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at))[0];
    const completed = program.last_completed?.[row.id] || recent?.completed_at;
    return completed && Date.parse(today + 'T23:59:59+09:00') - Date.parse(completed)
      >= program.review_interval_days * 86400000;
  });
  return { today: todaySet, reviews, day: Math.max(0, Math.min(30, elapsed + 1)) };
}
