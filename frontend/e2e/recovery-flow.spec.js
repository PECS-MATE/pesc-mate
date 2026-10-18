import { test, expect, login } from './workflow-fixtures.js';

test.use({ serviceWorkers: 'block', profilePreset: null });

async function installSpeechStub(page) {
  await page.addInitScript(() => {
    window.__spokenTexts = [];
    class FakeSpeechSynthesisUtterance {
      constructor(text) {
        this.text = text;
      }
    }
    const speechSynthesis = {
      paused: false,
      getVoices: () => [{ name: '기기 한국어', lang: 'ko-KR', localService: true, voiceURI: 'local-ko' }],
      speak: utterance => {
        window.__spokenTexts.push(utterance.text);
        queueMicrotask(() => {
          utterance.onstart?.();
          utterance.onend?.();
        });
      },
      cancel: () => {},
      pause: () => { speechSynthesis.paused = true; },
      resume: () => { speechSynthesis.paused = false; },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FakeSpeechSynthesisUtterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: speechSynthesis });
  });
}

test('잘못 누른 표현을 취소하고 수정한 카드를 다시 말한다', async ({ page, communicator }) => {
  await installSpeechStub(page);
  await login(page, communicator);
  await page.getByRole('button', { name: /그림으로 말하기/ }).click();
  const workspace = page.locator('.workspace');

  await workspace.getByRole('button', { name: '나 문장에 담기' }).click();
  await workspace.getByRole('button', { name: '물 문장에 담기' }).click();
  await expect(page.locator('.board ol li')).toHaveCount(2);

  await page.getByRole('button', { name: '잘못 눌렀어요 복구 표현 말하기' }).click();
  await expect.poll(() => page.evaluate(() => window.__spokenTexts)).toContain('잘못 눌렀어요');

  await page.getByRole('button', { name: '현재 문장 취소' }).click();
  await expect(page.locator('.board ol li')).toHaveCount(0);

  await workspace.getByRole('button', { name: '나 문장에 담기' }).click();
  await workspace.getByRole('button', { name: '밥 문장에 담기' }).click();
  await workspace.getByRole('button', { name: '먹다 문장에 담기' }).click();
  await page.getByRole('button', { name: '선택 카드 그대로' }).click();
  await page.getByRole('button', { name: '선택 카드 그대로 말하기' }).click();

  await expect.poll(() => page.evaluate(() => window.__spokenTexts)).toContain('나 밥 먹다');
  await expect(page.locator('.board ol li')).toHaveCount(3);
});
