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
