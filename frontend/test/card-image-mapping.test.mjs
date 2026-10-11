import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const cardFiles = await readdir(new URL('../src/assets/cards/', import.meta.url));

test('bundled card images replace label spaces with underscores without an id map', () => {
  assert.match(app, /label\?\.trim\(\)\.replaceAll\(' ', '_'\)/);
  assert.match(app, /CARD_IMAGE_MODULES\[`\.\/assets\/cards\/\$\{filename\}\.png`\]/);
  assert.doesNotMatch(app, /CARD_IMAGE_NAMES|CARD_IMAGES/);
  assert.ok(cardFiles.length > 0);
  assert.ok(cardFiles.every(filename => filename.endsWith('.png')));
  assert.ok(cardFiles.every(filename => !filename.includes(' ')));
  assert.match(app, /expressionVisual\(item\)/);
});
