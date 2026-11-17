// Browser layout regression harness. Serves source CSS and representative demo DOM;
// no build, JSX compilation, account, or backend is needed.
import fs from 'node:fs/promises';
import { chapters } from '../frontend/public/promo/promo-presentation.js';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--live');
const output = path.join(root, '.local-validation', live ? 'promo-presentation' : 'promo-layout');
const deadline = Date.now() + (live ? 180000 : 90000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const styles = ['src/assets/caregiverUx.css',
  'node_modules/bootstrap/dist/css/bootstrap-grid.min.css', 'node_modules/bootstrap/dist/css/bootstrap-utilities.min.css',
  ...['styles', 'landing', 'activityUx', 'practiceUx', 'responsiveUx', 'speakingLibrary'].map(name => `src/assets/${name}.css`), 'src/promo/promo-demo.css'];
const art = label => `<span class="card-art" style="background-image:url('/src/assets/cards/${encodeURIComponent(label)}.png');background-position:center;background-size:cover"></span>`;
const tile = label => `<div class="promo-card">${art(label)}<strong>${label}</strong></div>`;
function fixture(scene) {
  const heading = '<div class="promo-heading"><div><p class="promo-eyebrow">그림으로 말하기</p><h1>나의 문장을 만들어요</h1></div><span class="promo-chip">문장으로 말하기</span></div>';
  const content = scene === 'home'
    ? `<p class="promo-eyebrow">반가워요!</p><h1>오늘은 어떤 이야기를 할까요?</h1><p class="promo-description">카드를 고르고, 나의 마음을 전해 보세요.</p><section class="home-screen"><div class="home-mode-grid home-launcher-grid">${['말하기', '연습하기'].map(label => `<button class="home-activity"><span class="home-activity-pictures"><span class="home-activity-picture" style="background-image:url('/src/assets/cards/물.png')"></span></span><strong>${label}</strong></button>`).join('')}</div></section>`
    : scene === 'cards'
      ? `${heading}<div class="promo-sentence">${['나', '물', '마시다'].map(label => `<div class="promo-mini">${art(label)}<b>${label}</b></div>`).join('')}<div class="promo-speak">말하기</div></div><div class="promo-output"><span>▂ ▅ ▃ ▇ ▄ ▆ ▂</span><strong>나는 물을 마시고 싶어요.</strong></div><div class="promo-categories"><span class="active">전체</span><span>사람</span><span>음식과 음료</span><span>동작</span><span>감정</span></div><div class="promo-card-grid">${['나', '물', '마시다', '밥', '사과', '우유', '먹다', '좋아요'].map(tile).join('')}</div>`
      : scene === 'practice'
        ? `${heading}<div class="promo-practice">${art('사과')}<span>참 잘했어요!</span></div><div class="promo-answers">${['물', '사과', '밥'].map(tile).join('')}</div>`
        : '<div class="promo-closing"><img src="/pecsmate.png" alt="PECS MATE"><p class="promo-eyebrow">PECS MATE</p><h1>그림으로 전하는<br>나의 마음, 나의 목소리</h1><p>카드를 고르고, 문장을 만들고, 마음을 전해요.</p></div>';
  return `<!doctype html><html lang="ko" class="promo-document"><head><meta charset="utf-8">${styles.map(file => `<link rel="stylesheet" href="/${file}">`).join('')}<style>*{animation:none!important;transition:none!important}</style></head><body><div id="root"><div class="promo-demo is-paused" data-layout-scene="${scene}"><aside class="promo-sidebar"><img src="/pecsmate.png" alt="PECS MATE"><span class="promo-wordmark">PECS MATE</span><nav><button>홈</button><button>말하기</button><button>연습하기</button></nav><span class="promo-example">시연용 예시 화면</span></aside><main class="promo-workspace"><header class="promo-header"><span>오늘도, 나답게 표현해요</span><span class="promo-profile">나의 공간 ●</span></header><section class="promo-content">${content}</section><footer class="promo-caption"><span class="promo-caption-number">06</span><span>카드를 모으면, 하나의 문장으로</span><div class="promo-progress"><span style="width:60%"></span></div></footer></main></div></div></body></html>`;
}

await fs.mkdir(output, { recursive: true });
let scene = 'home';
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(fixture(scene)); return; }
    const relative = pathname === '/promo-ipad.html' || pathname === '/pecsmate.png' || pathname.startsWith('/promo/') ? `public${pathname}` : pathname.slice(1);
    const filename = path.resolve(root, 'frontend', relative);
    if (!filename.startsWith(path.join(root, 'frontend') + path.sep)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8');
    response.end(await fs.readFile(filename));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = live ? (process.env.PROMO_BASE_URL || 'http://localhost:5173') : `http://127.0.0.1:${server.address().port}`;
const browserPath = process.env.PROMO_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = path.join(output, `chrome-${Date.now()}`);
const browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket;
let closeBrowser;
try {
  let port;
  while (!port && Date.now() < deadline) {
    try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { await pause(100); }
    if (browser.exitCode !== null) throw new Error(`Chrome exited: ${browser.exitCode}`);
  }
  if (!port) throw new Error('Chrome did not expose DevTools before deadline');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id); clearTimeout(timer); pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
    }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, Math.max(1, Math.min(10000, deadline - Date.now())));
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  closeBrowser = () => call('Browser.close');
  await call('Page.enable');
  const failures = [];
  if (live) {
    const waitFor = async expression => {
      while (Date.now() < deadline) { if (await evaluate(`Boolean(${expression})`)) return; await pause(60); }
      throw new Error(`Readiness deadline: ${expression}`);
    };
    let loaded = false;
    for (const [width, height] of [[320, 640], [768, 1024], [1024, 768], [1440, 900], [1920, 1080]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      if (!loaded) {
        await call('Page.navigate', { url: `${address}/promo-ipad.html` });
        await waitFor(`document.querySelectorAll('.chapters button').length === ${chapters.length} && document.querySelector('iframe')?.contentDocument?.querySelector('.promo-demo:not(.is-loading)')`);
        await waitFor(`[...document.querySelectorAll('.visual-panel img')].every(img => img.complete && img.naturalWidth > 0)`);
        loaded = true;
      }
      for (let chapter = 0; chapter < chapters.length; chapter++) {
        await evaluate(`document.querySelectorAll('.chapters button')[${chapter}].click()`);
        await pause(500);
        const issues = await evaluate(`(() => {
          const issues = [], canvas = document.querySelector('.presentation').getBoundingClientRect();
          const toolbar = document.querySelector('.toolbar').getBoundingClientRect();
          const story = document.querySelector('.story').getBoundingClientRect();
          const visual = document.querySelector('.visual').getBoundingClientRect();
          const footer = document.querySelector('.presentation-footer').getBoundingClientRect();
          const iframe = document.querySelector('iframe'), doc = iframe.contentDocument;
          if (canvas.left < -1 || canvas.right > innerWidth + 1 || canvas.top < -1 || canvas.bottom > toolbar.top - 5) issues.push('presentation clipped or overlaps toolbar');
          if (story.right > visual.left || story.bottom > footer.top || visual.bottom > footer.top) issues.push('story, visual, or footer overlaps');
          for (const img of document.querySelectorAll('.visual-panel img')) if (!img.complete || !img.naturalWidth) issues.push('PDF image missing');
          if (document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight) issues.push('outer document overflows');
          if (document.body.dataset.visual === 'architecture') {
            const panel = document.querySelector('.architecture-panel').getBoundingClientRect();
            const architectureFooter = document.querySelector('.architecture-footer').getBoundingClientRect();
            for (const el of document.querySelectorAll('.architecture-node, .architecture-footer')) {
              const box = el.getBoundingClientRect();
              if (box.left < panel.left - 1 || box.right > panel.right + 1 || box.bottom > panel.bottom + 1 || el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) issues.push('architecture node overflows');
              if (el.classList.contains('architecture-node') && box.bottom > architectureFooter.top + .5) issues.push('architecture node overlaps footer');
            }
          }
          if (doc.documentElement.scrollWidth > iframe.clientWidth || doc.documentElement.scrollHeight > iframe.clientHeight) issues.push('React demo overflows');
          const caption = doc.querySelector('.promo-caption').getBoundingClientRect();
          if ([...doc.querySelector('.promo-content').children].some(el => el.getBoundingClientRect().bottom > caption.top + 1)) issues.push('React scene overlaps caption');
          return issues;
        })()`);
        const name = `${width}x${height}-chapter-${chapter + 1}`;
        if (issues.length) failures.push({ name, issues });
        if (width === 1920 || (width === 320 && chapter === 2) || issues.length) {
          const screenshot = await call('Page.captureScreenshot', { format: 'png' });
          await fs.writeFile(path.join(output, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
        }
        console.log(`${issues.length ? 'FAIL' : 'PASS'} ${name}: ${issues.join('; ') || 'presentation and React demo fit'}`);
      }
    }
    await evaluate(`document.querySelectorAll('.chapters button')[2].click(); document.querySelector('#play').click()`);
    await waitFor(`document.querySelector('iframe').contentDocument.querySelectorAll('.promo-mini').length === 1`);
    await evaluate(`document.querySelector('#play').click()`);
    const controls = await evaluate(`(() => {
      const issues = [];
      document.querySelector('#recording').click();
      if (getComputedStyle(document.querySelector('.toolbar')).display !== 'none') issues.push('recording toolbar visible');
      if (getComputedStyle(document.querySelector('.restore')).opacity !== '0') issues.push('restore control visible in recording');
      document.querySelector('iframe').contentDocument.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if (document.body.classList.contains('recording')) issues.push('iframe Escape restoration failed');
      document.querySelector('#layout').click();
      if (!document.body.classList.contains('tablet-only')) issues.push('tablet layout failed');
      document.querySelector('#layout').click();
      if (document.body.classList.contains('tablet-only')) issues.push('presentation layout failed');
      document.querySelector('#mode').click();
      if (!document.querySelector('iframe').src.endsWith('/') || !document.body.classList.contains('tablet-only')) issues.push('actual app mode failed');
      document.querySelector('#mode').click();
      return issues;
    })()`);
    if (controls.length) failures.push({ name: 'controls', issues: controls });
    await waitFor(`document.querySelector('iframe')?.contentDocument?.querySelector('.promo-demo:not(.is-loading)')`);
    console.log(`${controls.length ? 'FAIL' : 'PASS'} live cue synchronization, recording, iframe Escape, layout and app mode`);
  } else {
  for (const [width, height] of [[320, 640], [768, 1024], [1024, 768], [1440, 900], [1920, 1080]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    for (scene of ['home', 'cards', 'practice', 'closing']) {
      if (Date.now() >= deadline) throw new Error('Layout check deadline exceeded');
      await call('Page.navigate', { url: `${address}/promo-ipad.html?view=tablet&scene=${scene}` });
      let ready = false;
      while (!ready && Date.now() < deadline) {
        ready = await evaluate(`document.querySelector('iframe')?.contentDocument?.querySelector('.promo-demo')?.dataset.layoutScene === ${JSON.stringify(scene)} && document.querySelector('iframe').contentDocument.readyState === 'complete'`);
        if (!ready) await pause(50);
      }
      const result = await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        const frame = document.querySelector('iframe'), doc = frame.contentDocument;
        const box = document.querySelector('.tablet').getBoundingClientRect();
        const toolbar = document.querySelector('.toolbar').getBoundingClientRect();
        const content = doc.querySelector('.promo-content').getBoundingClientRect();
        const footer = doc.querySelector('.promo-caption').getBoundingClientRect();
        const children = [...doc.querySelector('.promo-content').children].map(el => el.getBoundingClientRect());
        const issues = [];
        if (box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > toolbar.top - 8) issues.push('tablet clipped or overlaps toolbar');
        if (Math.abs((box.left + box.right) / 2 - innerWidth / 2) > 2) issues.push('tablet not horizontally centered');
        if (doc.documentElement.scrollWidth > frame.clientWidth || doc.documentElement.scrollHeight > frame.clientHeight) issues.push('iframe document overflows');
        if (children.some(box => box.bottom > footer.top + 1 || box.right > content.right + 1 || box.left < content.left - 1)) issues.push('scene content overlaps caption or escapes content');
        const picture = doc.querySelector('.home-activity-picture');
        if (picture && picture.getBoundingClientRect().width > picture.parentElement.getBoundingClientRect().width + 1) issues.push('home picture escapes its container');
        resolve({ issues, tablet: { left: box.left, top: box.top, right: box.right, bottom: box.bottom }, inner: { width: doc.documentElement.scrollWidth, height: doc.documentElement.scrollHeight } });
      })))`);
      const name = `${width}x${height}-${scene}`;
      if (result.issues.length) failures.push({ name, ...result });
      if (width === 320 || width === 1440 || result.issues.length) {
        const screenshot = await call('Page.captureScreenshot', { format: 'png' });
        await fs.writeFile(path.join(output, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
      }
      console.log(`${result.issues.length ? 'FAIL' : 'PASS'} ${name}: ${result.issues.join('; ') || 'frame and scene fit'}`);
    }
    const collapsed = await evaluate(`(() => {
      const toggle = document.querySelector('#toolbar-toggle'), toolbar = document.querySelector('.toolbar');
      const before = document.querySelector('.tablet').getBoundingClientRect().height;
      toggle.focus(); toggle.click();
      const box = document.querySelector('.tablet').getBoundingClientRect(), button = toggle.getBoundingClientRect();
      const issues = [];
      if (!toolbar.hidden || toggle.getAttribute('aria-expanded') !== 'false') issues.push('toolbar did not collapse');
      if (box.bottom > button.top - 8 || box.top < 0 || box.height < before) issues.push('collapsed tablet fit failed');
      if (button.left < 0 || button.right > innerWidth || button.bottom > innerHeight) issues.push('toggle outside viewport');
      toggle.click();
      if (toolbar.hidden || toggle.getAttribute('aria-expanded') !== 'true') issues.push('toolbar did not reopen');
      return issues;
    })()`);
    if (collapsed.length) failures.push({ name: `${width}x${height}-toolbar-toggle`, issues: collapsed });
    console.log(`${collapsed.length ? 'FAIL' : 'PASS'} ${width}x${height}-toolbar-toggle: ${collapsed.join('; ') || 'collapse, fit and restore'}`);
    const recording = await evaluate(`(() => {
      document.getElementById('recording').click();
      const box = document.querySelector('.tablet').getBoundingClientRect();
      const toggleHidden = getComputedStyle(document.querySelector('#toolbar-toggle')).display === 'none';
      const fits = toggleHidden && box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1;
      const centered = Math.abs((box.top + box.bottom) / 2 - innerHeight / 2) <= 1;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return { pass: fits && centered && !document.body.classList.contains('recording'), fits, centered, box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom }, scrollY };
    })()`);
    if (!recording.pass) failures.push({ name: `${width}x${height}-recording`, issues: ['recording frame fit or Esc restoration failed'], ...recording });
    console.log(`${recording.pass ? 'PASS' : 'FAIL'} ${width}x${height}-recording: frame fit and Esc restoration${recording.pass ? '' : JSON.stringify(recording)}`);
  }
  }
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  if (closeBrowser) await Promise.race([closeBrowser().catch(() => {}), pause(2000)]);
  socket?.close();
  if (browser.exitCode === null) browser.kill();
  await new Promise(resolve => { if (browser.exitCode !== null) resolve(); else { browser.once('exit', resolve); setTimeout(resolve, 3000); } });
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
