export function shuffled(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function learningQuestions(cards, questionCount, random = Math.random) {
  if (cards.length < 2) return [];
  const targets = [];
  while (targets.length < questionCount) targets.push(...shuffled(cards, random));
  return targets.slice(0, questionCount).map(target => ({
    target,
    options: shuffled([
      target,
      ...shuffled(cards.filter(card => card.id !== target.id), random).slice(0, 2),
    ], random),
  }));
}
