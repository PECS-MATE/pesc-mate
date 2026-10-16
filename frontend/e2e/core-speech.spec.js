import { test, expect } from './fixtures.js';

// Network blocking below deliberately leaves the dev app shell available. These
// cases verify persisted audio across pages, not a full offline PWA cold start.
test.use({ serviceWorkers: 'block' });

async function observeNativeAudio(page, { synthesis = 'missing', offline = false } = {}) {
  await page.addInitScript(({ synthesis, offline }) => {
    window.__coreAudio = { plays: [], events: [], synthesisCalls: [] };
    const observed = new WeakSet();
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      window.__coreAudio.plays.push(this.src);
      if (!observed.has(this)) {
        observed.add(this);
        for (const type of ['playing', 'ended', 'error']) {
          this.addEventListener(type, () => window.__coreAudio.events.push({
            type, src: this.currentSrc, duration: this.duration,
            currentTime: this.currentTime, readyState: this.readyState,
            error: this.error?.code || null,
          }));
        }
      }
      return nativePlay.apply(this, args);
    };
    if (offline) Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    if (synthesis === 'missing') {
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: undefined });
      return;
    }
    class TestUtterance { constructor(text) { this.text = text; } }
    const fakeSynthesis = {
      paused: false,
      getVoices: () => [{ name: '기기 한국어', lang: 'ko-KR', localService: true, voiceURI: 'local-ko' }],
      speak: utterance => {
        window.__coreAudio.synthesisCalls.push(utterance.text);
        queueMicrotask(() => utterance.onerror?.({ error: 'voice-unavailable' }));
      },
      cancel: () => {}, pause: () => {}, resume: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
    };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: fakeSynthesis });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: TestUtterance });
  }, { synthesis, offline });
}

async function loginAsUser(page) {
  await page.goto('/');
  await page.getByLabel('아이디').fill('demo');
  await page.getByLabel('비밀번호').fill('demo1234');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  const profileHeading = page.getByRole('heading', { name: '처음 사용할 프로필을 골라 주세요' });
  await expect(page.getByRole('button', { name: '로그아웃' }).or(profileHeading)).toBeVisible();
  if (await profileHeading.isVisible()) {
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: '프로필 저장' }).click();
  }
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
}

async function cachedBundleSummary(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pesc-mate-offline', 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const read = (store, key) => new Promise((resolve, reject) => {
        const request = database.transaction(store).objectStore(store).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const bundle = await read('coreSpeech', 'bundle');
      const account = await read('account', 'current');
      const snapshot = account ? await read('snapshots', account.id) : null;
      return {
        version: bundle?.manifest?.version,
        entries: bundle?.manifest?.entries?.length || 0,
        clips: bundle?.clips?.filter(clip => clip.blob instanceof Blob && clip.blob.size > 44).length || 0,
        accountReady: Boolean(account?.profile && snapshot),
      };
    } finally { database.close(); }
  });
}

async function expectNativeClip(page, buttonName, text, previousPlays = 0) {
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__coreAudio.plays.length)).toBe(previousPlays + 1);
  await expect.poll(() => page.evaluate(() => window.__coreAudio.events.filter(event => event.type === 'ended').length), {
    timeout: 10000,
  }).toBe(previousPlays + 1);
  const media = await page.evaluate(previousPlays => {
    const src = window.__coreAudio.plays[previousPlays];
    return {
      src,
      playing: window.__coreAudio.events.find(event => event.type === 'playing' && event.src === src),
      ended: window.__coreAudio.events.find(event => event.type === 'ended' && event.src === src),
      errors: window.__coreAudio.events.filter(event => event.type === 'error'),
    };
  }, previousPlays);
  expect(media.src).toMatch(/^blob:/);
  expect(media.playing?.readyState).toBeGreaterThanOrEqual(2);
  expect(media.ended?.duration).toBeGreaterThan(0.2);
  expect(media.ended?.currentTime).toBeCloseTo(media.ended.duration, 1);
  expect(media.errors).toEqual([]);

  // Check that the native player decoded the requested phrase's persisted bytes.
  const matchesSavedClip = await page.evaluate(async ({ src, text }) => {
    const played = new Uint8Array(await (await fetch(src)).arrayBuffer());
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pesc-mate-offline', 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const bundle = await new Promise((resolve, reject) => {
        const request = database.transaction('coreSpeech').objectStore('coreSpeech').get('bundle');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const clip = bundle.clips.find(item => item.text === text);
      if (!clip) return false;
      const stored = new Uint8Array(await clip.blob.arrayBuffer());
      return played.length === stored.length && played.every((byte, index) => byte === stored[index]);
    } finally { database.close(); }
  }, { src: media.src, text });
  expect(matchesSavedClip).toBe(true);
}

test('기본 음성을 자동 재생 없이 저장하고 새 페이지에서 네트워크 없이 실제 재생한다', async ({ page, context }) => {
  await observeNativeAudio(page);
  await loginAsUser(page);
  await expect(page.getByTestId('core-speech-status')).toContainText('기본 긴급·복구 음성 13개 저장됨', { timeout: 20000 });
  await expect.poll(() => cachedBundleSummary(page)).toEqual({
    version: 'v1', entries: 13, clips: 13, accountReady: true,
  });
  expect(await page.evaluate(() => window.__coreAudio.plays)).toEqual([]);
  await page.close();

  const restored = await context.newPage();
  await observeNativeAudio(restored, { offline: true });
  await restored.route('**/api/**', route => route.abort('internetdisconnected'));
  await restored.route('**/audio/core/**', route => route.abort('internetdisconnected'));
  await restored.goto('/');
  await expect(restored.getByRole('button', { name: '로그아웃' })).toBeVisible();
  await expect(restored.getByTestId('core-speech-status')).toContainText('기본 긴급·복구 음성 13개 저장됨', { timeout: 20000 });
  expect(await restored.evaluate(() => navigator.onLine)).toBe(false);
  expect(await restored.evaluate(() => window.__coreAudio.plays)).toEqual([]);
  await expectNativeClip(restored, '도와주세요 바로 말하기', '도와주세요');
  await expectNativeClip(restored, '잘못 눌렀어요 복구 표현 말하기', '잘못 눌렀어요', 1);
  await restored.close();
});

test('기기 한국어 음성이 실패하면 기본 음성으로 복구하고 성공 이력을 한 번 저장한다', async ({ page }) => {
  await observeNativeAudio(page, { synthesis: 'fails' });
  const events = [];
  page.on('response', response => {
    const request = response.request();
    if (/\/api\/tts\/events(?:\/[^/?]+)?$/.test(new URL(response.url()).pathname)
      && ['POST', 'PATCH'].includes(request.method())) {
      events.push({
        method: request.method(), status: response.status(),
        path: new URL(response.url()).pathname, body: request.postDataJSON(),
      });
    }
  });
  await loginAsUser(page);
  await expect(page.getByTestId('core-speech-status')).toContainText('기본 긴급·복구 음성 13개 저장됨', { timeout: 20000 });
  expect(await page.evaluate(() => window.__coreAudio.synthesisCalls)).toEqual([]);
  await expectNativeClip(page, '도와주세요 바로 말하기', '도와주세요');
  expect(await page.evaluate(() => window.__coreAudio.synthesisCalls)).toEqual(['도와주세요']);
  // Tracking is asynchronous and may wait for a browser connection behind card
  // images. Allow the API's 15-second request deadline, not just the 5-second
  // default assertion window; playback itself is asserted separately above.
  await expect.poll(() => events.length, { timeout: 20000 }).toBe(2);
  expect(events.filter(event => event.method === 'POST')).toEqual([
    expect.objectContaining({ status: 201, body: expect.objectContaining({ content_type: 'card' }) }),
  ]);
  expect(events.filter(event => event.method === 'PATCH')).toEqual([
    expect.objectContaining({ status: 200, body: expect.objectContaining({ status: 'succeeded' }) }),
  ]);
  const start = events.find(event => event.method === 'POST');
  const finish = events.find(event => event.method === 'PATCH');
  expect(finish.path).toBe(`/api/tts/events/${start.body.request_id}`);
});
