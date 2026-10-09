import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/assets/styles.css', import.meta.url), 'utf8');

test('core controls expose at least a 44 by 44 CSS pixel target', () => {
  assert.match(css, /button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px\s*!important;/s);
  assert.match(css, /\.accessibility-settings select\s*\{[^}]*min-height:\s*44px;/s);
});

test('repeated core controls have at least 8 CSS pixels between targets', () => {
  for (const selector of ['.quick-speech', '.categories, .actions', '.output-mode', '.sidebar nav']) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`${escaped}\\s*\\{[^}]*gap:\\s*(\\d+)px`, 's'));
    assert.ok(match, `${selector} must define a gap`);
    assert.ok(Number(match[1]) >= 8, `${selector} gap must be at least 8px`);
  }
});

test('keyboard users receive a skip link and a visible focus indicator', () => {
  assert.match(app, /className="skip-link" href="#main-content"/);
  assert.match(app, /id="main-content" tabIndex="-1"/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*4px/s);
  assert.doesNotMatch(app, /tabIndex=\{?["']?[1-9]/);
});

test('AAC control groups preserve DOM order for switch scanning adapters', () => {
  for (const group of ['quick-speech', 'output-mode', 'categories', 'cards']) {
    assert.match(app, new RegExp(`data-scan-group="${group}"`));
  }
});

test('motion reduction and high contrast preferences have concrete styles', () => {
  assert.match(css, /\.reduced-motion \*, \.reduced-motion \*::before, \.reduced-motion \*::after/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.high-contrast :focus-visible/);
});
