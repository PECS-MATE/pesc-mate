import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chapters, demoStepAt, totalDuration } from '../frontend/public/promo/promo-presentation.js';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(new URL('../frontend/public/promo-ipad.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../frontend/public/promo/promo-ipad.js', import.meta.url), 'utf8');
function setup(reduced = false, ready = true) {
  const dom = new JSDOM(html, { url: 'http://localhost:5173/promo-ipad.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  let clock = 0, tick;
  const messages = [];
  window.matchMedia = () => ({ matches: reduced });
  window.ResizeObserver = class { observe() {} };
  window.setInterval = callback => { tick = callback; };
  Object.defineProperty(window.performance, 'now', { value: () => clock });
  window.document.querySelector('iframe').contentWindow.postMessage = message => messages.push(message);
  window.eval(script.replace(/^import .*;\r?\n/, `const chapters = ${JSON.stringify(chapters)}; const totalDuration = ${totalDuration}; const demoStepAt = ${demoStepAt.toString()};\n`));
  const signalReady = () => window.dispatchEvent(new window.MessageEvent('message', { origin: window.location.origin, source: window.document.querySelector('iframe').contentWindow, data: { type: 'pecsmate:promo-state', ready: true, playing: false, step: 0 } }));
  if (ready) signalReady();
  return { dom, document: window.document, window, messages, signalReady, advance(ms) { for (let n = 0; n < ms; n += 100) { clock += Math.min(100, ms - n); tick(); } } };
}
test('presentation waits for decoded demo images before starting its clock', () => {
  const s = setup(false, false); s.advance(10000);
  assert.equal(s.document.body.dataset.chapter, '0');
  s.signalReady(); s.advance(8000); assert.equal(s.document.body.dataset.chapter, '1');
  s.dom.window.close();
});
test('PDF presentation has eight chapters, a 90-second loop and ordered speaking cues', () => {
  assert.equal(chapters.length, 8); assert.equal(totalDuration, 90000);
  assert.deepEqual([0, 2000, 4500, 7000, 10000, 13000].map(ms => demoStepAt(chapters[2], ms)), [1, 2, 3, 4, 5, 6]);
  assert.match(chapters[5].note, /향후 계획/);
});
test('presentation clock synchronizes cards, preserves pause position and loops to the beginning', () => {
  const s = setup(); const click = id => s.document.querySelector(id).click();
  s.advance(17000); assert.equal(s.document.body.dataset.chapter, '2');
  s.advance(2000); assert.equal(s.messages.at(-1).step, 2);
  click('#play'); const count = s.messages.length; s.advance(20000);
  assert.equal(s.document.body.dataset.chapter, '2'); assert.equal(s.messages.length, count);
  click('#play'); s.advance(2500); assert.equal(s.messages.at(-1).step, 3);
  click('#restart'); s.advance(90000); assert.equal(s.document.body.dataset.chapter, '0'); assert.equal(s.messages.at(-1).step, 0);
  click('#previous'); assert.equal(s.document.body.dataset.chapter, '7'); assert.equal(s.document.querySelector('#play').textContent, '재생');
  s.dom.window.close();
});
test('reduced motion, manual chapters, recording, layout and app switching remain controllable', () => {
  const s = setup(true); const click = id => s.document.querySelector(id).click();
  s.advance(8000); assert.equal(s.document.body.dataset.chapter, '0');
  s.document.querySelectorAll('.chapters button')[4].click(); assert.equal(s.document.body.dataset.chapter, '4');
  assert.equal(s.document.querySelector('[aria-current="step"]').textContent, 'RFID 연결');
  click('#recording'); assert.ok(s.document.body.classList.contains('recording'));
  s.document.dispatchEvent(new s.window.KeyboardEvent('keydown', { key: 'Escape' })); assert.ok(!s.document.body.classList.contains('recording'));
  click('#layout'); assert.ok(s.document.body.classList.contains('tablet-only')); assert.ok(s.document.querySelector('#previous').hidden);
  click('#layout'); assert.ok(!s.document.body.classList.contains('tablet-only'));
  click('#mode'); assert.ok(s.document.querySelector('#play').hidden); assert.equal(s.document.querySelector('iframe').getAttribute('src'), '/');
  click('#mode'); assert.ok(!s.document.querySelector('#play').hidden); assert.equal(s.document.querySelector('iframe').getAttribute('src'), '/?promo=demo');
  s.dom.window.close();
});

test('architecture chapter displays editable system nodes and restores the regular layout', () => {
  const s = setup(true);
  s.document.querySelectorAll('.chapters button')[6].click();
  assert.equal(s.document.body.dataset.visual, 'architecture');
  assert.equal(s.document.querySelector('.visual').dataset.visual, 'architecture');
  const panel = s.document.querySelector('.architecture-panel');
  for (const label of ['React', 'FastAPI', 'MongoDB', 'Tesseract', 'Qwen3-TTS', 'OpenRouter', 'USB Serial']) assert.ok(panel.textContent.includes(label));
  assert.equal(panel.querySelectorAll('.architecture-column').length, 4);
  assert.ok(panel.querySelectorAll('svg use').length >= 7);
  assert.equal(panel.querySelectorAll('img').length, 0);
  s.document.querySelectorAll('.chapters button')[7].click();
  assert.equal(s.document.body.dataset.visual, 'demo');
  s.dom.window.close();
});


test('toolbar can collapse without pausing and restores with its button or iframe Escape', () => {
  const s = setup();
  const toolbar = s.document.querySelector('.toolbar');
  const toggle = s.document.querySelector('#toolbar-toggle');
  toggle.focus(); toggle.click();
  assert.ok(toolbar.hidden);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(s.document.activeElement, toggle);
  s.advance(8000); assert.equal(s.document.body.dataset.chapter, '1');
  toggle.click(); assert.ok(!toolbar.hidden);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  s.document.querySelector('#layout').click();
  toggle.click(); assert.ok(toolbar.hidden);
  const frame = s.document.querySelector('iframe');
  frame.dispatchEvent(new s.window.Event('load'));
  frame.contentDocument.dispatchEvent(new s.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.ok(!toolbar.hidden);
  assert.ok(s.document.body.classList.contains('tablet-only'));
  s.dom.window.close();
});
