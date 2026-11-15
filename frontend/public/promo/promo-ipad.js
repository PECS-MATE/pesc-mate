const tablet = document.querySelector('.tablet');
const frame = document.querySelector('iframe');
const status = document.querySelector('.status');
let demo = true;
function send(command) {
  frame.contentWindow.postMessage({ type: 'pecsmate:promo-command', command }, location.origin);
}
document.querySelector('#play').addEventListener('click', () => send('toggle'));
document.querySelector('#restart').addEventListener('click', () => send('restart'));
document.querySelector('#next').addEventListener('click', () => send('next'));
document.querySelector('#mode').addEventListener('click', (event) => {
  demo = !demo;
  frame.src = demo ? '/?promo=demo' : '/';
  frame.title = demo ? 'PECS MATE 자동 시연 애니메이션' : 'PECS MATE 실제 서비스';
  event.currentTarget.textContent = demo ? '실제 앱 조작' : '자동 시연';
  for (const id of ['play', 'restart', 'next']) document.getElementById(id).hidden = !demo;
  fit();
});
addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== 'pecsmate:promo-state') return;
  document.querySelector('#play').textContent = event.data.playing ? '일시정지' : '재생';
});
function fit() {
  const controls = document.body.classList.contains('recording') ? 0 : document.querySelector('.toolbar').offsetHeight + 36;
  tablet.style.setProperty('--controls-space', `${controls}px`);
  tablet.style.setProperty('--scale', Math.max(.01, Math.min((innerWidth - 48) / 1250, (innerHeight - controls - 48) / 942)));
}
function restore() { document.body.classList.remove('recording'); fit(); }
document.querySelector('#background').addEventListener('click', (event) => {
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
  status.textContent = '';
  document.body.classList.add('recording');
  frame.focus();
  fit();
});
document.querySelector('.restore').addEventListener('click', restore);
function onKey(event) { if (event.key === 'Escape') restore(); }
document.addEventListener('keydown', onKey);
frame.addEventListener('load', () => {
  try { frame.contentWindow.document.addEventListener('keydown', onKey); } catch { /* The embedded app is served on the same origin. */ }
});
document.addEventListener('fullscreenchange', () => {
  document.querySelector('#fullscreen').textContent = document.fullscreenElement ? '전체 화면 해제' : '전체 화면';
  fit();
});
addEventListener('resize', fit);
fit();
