export const STEP_MS = 2600;
export const captions = [
  '그림으로 시작하는 나의 이야기', '전하고 싶은 카드를 찾아요',
  '나', '나 + 물', '나 + 물 + 마시다',
  '카드를 모으면, 하나의 문장으로', '나는 물을 마시고 싶어요',
  '놀이처럼, 차근차근 연습해요', '그림을 보고 알맞은 카드를 골라요',
  '잘했어요! 한 번 더 성장했어요', '작은 선택이, 나의 목소리가 되도록',
];

export function nextStep(step) { return (step + 1) % captions.length; }

export function sceneAt(step) {
  return step === 0 ? 'home' : step < 7 ? 'cards' : step < 10 ? 'practice' : 'closing';
}

export function selectedCountAt(step) {
  return sceneAt(step) === 'cards' ? Math.max(0, Math.min(step - 1, 3)) : 0;
}
