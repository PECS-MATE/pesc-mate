import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const speakText = app.slice(app.indexOf('function speakText('), app.indexOf('function rememberAndSpeakSentence('));

test('playback starts before network tracking with synchronous errors supported', () => {
  assert.ok(speakText.indexOf('speechPlayback.speak({') >= 0);
  assert.ok(speakText.indexOf('speechEvent.started = new Promise') < speakText.indexOf('speechPlayback.speak({'));
  assert.ok(speakText.indexOf('speechPlayback.speak({') < speakText.lastIndexOf('resolveStarted(startTracking())'));
});
test('speech protects against duplicate taps and silent volume', () => {
  assert.match(speakText, /tappedAt - lastSpeechTapRef\.current\.at < 600/);
  assert.match(speakText, /ttsSettings\.volume <= 0/);
  assert.match(speakText, /volume: ttsSettings\.volume/);
  assert.match(app, /기본 볼륨 <output>/);
});
test('speech records startup latency without storing spoken text', () => {
  assert.match(speakText, /requestedAt: Date\.now\(\), startupMs: null/);
  assert.match(speakText, /speechEvent\.startupMs = Math\.max\(0, Date\.now\(\) - speechEvent\.requestedAt\)/);
  assert.match(app, /startup_ms: event\.startupMs/);
  assert.doesNotMatch(app, /startup_ms:.*content/);
});

test('screen lock cancels stale speech and refreshes voices after return', () => {
  assert.match(app, /document\.visibilityState === 'hidden'/);
  assert.match(app, /finishSpeechEvent\(speechEventRef\.current, 'cancelled', 'screen-hidden'\)/);
  assert.match(app, /document\.addEventListener\('visibilitychange', handleVisibility\)/);
  assert.match(app, /window\.addEventListener\('focus', updateVoices\)/);
  assert.match(app, /document\.removeEventListener\('visibilitychange', handleVisibility\)/);
});
