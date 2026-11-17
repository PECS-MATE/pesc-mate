import { chapters, demoStepAt, totalDuration } from './promo-presentation.js';

const frame = document.querySelector('iframe');
const status = document.querySelector('.status');
const story = document.querySelector('.story');
const visual = document.querySelector('.visual');
const progress = document.querySelector('.chapter-progress > span');
const play = document.querySelector('#play');
const toolbar = document.querySelector('.toolbar');
const toolbarToggle = document.querySelector('#toolbar-toggle');
let demo = true;
let tabletOnly = new URLSearchParams(location.search).get('view') === 'tablet';
let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let index = 0;
let elapsed = 0;
let lastTick = performance.now();
let lastCue = -1;
let demoReady = false;
function send(command, extra = {}) {
  frame.contentWindow.postMessage({ type: 'pecsmate:promo-command', command, ...extra }, location.origin);
}
const buttons = chapters.map((chapter, chapterIndex) => {
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = chapter.label;
  button.addEventListener('click', () => jump(chapterIndex));
  document.querySelector('.chapters').append(button);
  return button;
});
function syncCue(force = false) {
  if (!demo || tabletOnly) return;
  const cue = demoStepAt(chapters[index], elapsed);
  if (force || cue !== lastCue) { send('seek', { step: cue }); lastCue = cue; }
}
function updatePlay() { play.textContent = playing ? '일시정지' : '재생'; }
function render() {
  const chapter = chapters[index];
  story.querySelector('.eyebrow').textContent = chapter.eyebrow;
  story.querySelector('h1').textContent = chapter.title;
  story.querySelector('.description').textContent = chapter.description;
  story.querySelector('.story-note').textContent = chapter.note;
  story.querySelector('.tags').replaceChildren(...chapter.tags.map(text => {
    const tag = document.createElement('span'); tag.textContent = text; return tag;
  }));
  visual.dataset.visual = chapter.visual;
  document.body.dataset.visual = chapter.visual;
  frame.tabIndex = chapter.visual === 'demo' || tabletOnly ? 0 : -1;
  buttons.forEach((button, n) => { if (n === index) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current'); });
  document.querySelector('.chapter-count').textContent = `${String(index + 1).padStart(2, '0')} / ${String(chapters.length).padStart(2, '0')}`;
  document.body.dataset.chapter = String(index);
  for (const element of [story, visual]) { element.classList.remove('changing'); void element.offsetWidth; element.classList.add('changing'); }
  progress.style.width = `${elapsed / chapter.duration * 100}%`;
  syncCue(true); updatePlay();
}
function jump(target, resume = false) {
  index = (target + chapters.length) % chapters.length; elapsed = 0;
  playing = resume; lastTick = performance.now(); render();
}
function toggle() {
  if (!demo) return;
  if (tabletOnly) send('toggle');
  else { playing = !playing; lastTick = performance.now(); updatePlay(); }
}
play.addEventListener('click', toggle);
document.querySelector('#restart').addEventListener('click', () => tabletOnly ? send('restart') : jump(0, true));
document.querySelector('#next').addEventListener('click', () => tabletOnly ? send('next') : jump(index + 1));
document.querySelector('#previous').addEventListener('click', () => jump(index - 1));
function fit() {
  const toggleBottom = toolbar.hidden ? 14 : toolbar.offsetHeight + 22;
  toolbarToggle.style.bottom = `${toggleBottom}px`;
  const controls = document.body.classList.contains('recording') ? 0 : toggleBottom + toolbarToggle.offsetHeight + 14;
  const stage = document.querySelector('.stage');
  stage.style.setProperty('--controls-space', `${controls}px`);
  stage.style.setProperty('--presentation-scale', Math.max(.01, Math.min((innerWidth - 24) / 1600, (innerHeight - controls - 24) / 900)));
  stage.style.setProperty('--tablet-scale', Math.max(.01, Math.min((innerWidth - 48) / 1250, (innerHeight - controls - 48) / 942)));
}
function updateLayout() {
  document.body.classList.toggle('tablet-only', tabletOnly || !demo);
  document.querySelector('#layout').textContent = tabletOnly ? '발표 화면' : '아이패드만';
  document.querySelector('#layout').setAttribute('aria-pressed', String(tabletOnly));
  for (const id of ['play', 'restart', 'next', 'layout']) document.getElementById(id).hidden = !demo;
  document.querySelector('#previous').hidden = !demo || tabletOnly;
  fit();
}
document.querySelector('#layout').addEventListener('click', () => {
  tabletOnly = !tabletOnly; updateLayout();
  if (tabletOnly) { send('restart'); if (!playing) send('toggle'); }
  else { lastTick = performance.now(); render(); }
});
document.querySelector('#mode').addEventListener('click', (event) => {
  demo = !demo;
  demoReady = false;
  frame.src = demo ? '/?promo=demo' : '/';
  frame.title = demo ? 'PECS MATE 자동 시연 예시' : 'PECS MATE 실제 서비스';
  event.currentTarget.textContent = demo ? '실제 앱 조작' : '자동 시연';
  lastTick = performance.now(); updateLayout();
});
addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== 'pecsmate:promo-state') return;
  demoReady = event.data.ready === true;
  if (demo && tabletOnly) { playing = event.data.playing; updatePlay(); }
  // React can mount after the iframe load event; its first state is our ready signal.
  else if (demo && (event.data.playing || event.data.step !== demoStepAt(chapters[index], elapsed))) syncCue(true);
});
function setToolbarVisible(visible) {
  toolbar.hidden = !visible;
  toolbarToggle.setAttribute('aria-expanded', String(visible));
  toolbarToggle.textContent = visible ? '⚙️ ▾' : '⚙️ ▴';
  fit();
}
toolbarToggle.addEventListener('click', () => setToolbarVisible(toolbar.hidden));
function restore() { document.body.classList.remove('recording'); setToolbarVisible(true); }
document.querySelector('#background').addEventListener('click', event => {
  const plain = document.body.classList.toggle('plain');
  event.currentTarget.setAttribute('aria-pressed', String(plain));
  event.currentTarget.textContent = plain ? '민트 배경' : '흰 배경';
});
document.querySelector('#fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { status.textContent = '브라우저 메뉴에서 전체 화면을 선택해 주세요.'; }
});
document.querySelector('#recording').addEventListener('click', () => {
  status.textContent = ''; document.body.classList.add('recording');
  document.querySelector('.stage').focus(); fit();
});
document.querySelector('.restore').addEventListener('click', () => { restore(); document.querySelector('#recording').focus(); });
function onKey(event) {
  if (event.key === 'Escape') { restore(); return; }
  if (!demo || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(event.target?.tagName) || event.target?.isContentEditable || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.code === 'Space') { event.preventDefault(); toggle(); }
  if (!tabletOnly && ['ArrowRight', 'ArrowLeft', 'Home'].includes(event.key)) {
    event.preventDefault(); jump(event.key === 'Home' ? 0 : index + (event.key === 'ArrowRight' ? 1 : -1));
  }
}
document.addEventListener('keydown', onKey);
frame.addEventListener('load', () => {
  try { frame.contentWindow.document.addEventListener('keydown', onKey); } catch { /* Same-origin app normally permits this. */ }
  syncCue(true);
});
document.addEventListener('fullscreenchange', () => {
  document.querySelector('#fullscreen').textContent = document.fullscreenElement ? '전체 화면 해제' : '전체 화면'; fit();
});
addEventListener('resize', fit);
new ResizeObserver(fit).observe(document.querySelector('.toolbar'));
new ResizeObserver(fit).observe(toolbarToggle);
// One clock owns both chapter progress and the iframe's card-selection cues.
setInterval(() => {
  const now = performance.now(); const delta = now - lastTick; lastTick = now;
  if (!demo || tabletOnly || !playing || !demoReady) return;
  elapsed += delta;
  while (elapsed >= chapters[index].duration) { elapsed -= chapters[index].duration; index = (index + 1) % chapters.length; render(); }
  progress.style.width = `${elapsed / chapters[index].duration * 100}%`; syncCue();
}, 100);
updateLayout(); render();
