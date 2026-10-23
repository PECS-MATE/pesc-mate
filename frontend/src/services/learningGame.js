export const LEARNING_ACTIVITIES = {
  word_picture_match: { title: '단어·그림 맞추기', description: '그림과 알맞은 단어를 찾아보는 연습입니다.', version: 'word-picture-v1' },
  sound_picture_match: { title: '소리 듣고 카드 찾기', description: '문제 소리를 듣고 알맞은 그림 카드를 찾아보세요.', version: 'sound-picture-v1' },
};

export function shuffled(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function learningQuestions(cards, questionCount, optionCount = 3, repeatFrequency = 1,
                                  random = Math.random) {
  if (cards.length < optionCount) return [];
  const targets = [];
  while (targets.length < questionCount) {
    const cycle = shuffled(cards, random);
    for (let repeat = 0; repeat < repeatFrequency; repeat += 1) targets.push(...cycle);
  }
  return targets.slice(0, questionCount).map(target => ({
    target,
    options: shuffled([
      target,
      ...shuffled(cards.filter(card => card.id !== target.id), random).slice(0, optionCount - 1),
    ], random),
  }));
}
