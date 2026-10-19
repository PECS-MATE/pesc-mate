import { afterEach, beforeEach, expect, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

let urlIndex = 0;
URL.createObjectURL = vi.fn(() => `blob:component-${++urlIndex}`);
URL.revokeObjectURL = vi.fn();
// jsdom does not implement the native dialog top layer; Chrome E2E covers it.
HTMLDialogElement.prototype.showModal = function () { this.open = true; };

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  // Network, native audio and actual browser storage are verified by E2E.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Unexpected component-test network request'))));
});

afterEach(() => {
  cleanup();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
