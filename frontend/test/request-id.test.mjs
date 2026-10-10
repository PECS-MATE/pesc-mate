import assert from 'node:assert/strict';
import test from 'node:test';

import { createRequestId } from '../src/services/requestId.js';

test('request id uses the browser UUID implementation when available', () => {
  const expected = '11111111-2222-4333-8444-555555555555';
  assert.equal(createRequestId({ randomUUID: () => expected }), expected);
});

test('request id remains available on an insecure LAN origin', () => {
  const cryptoWithoutRandomUuid = {
    getRandomValues(bytes) {
      bytes.fill(0xab);
      return bytes;
    },
  };

  const id = createRequestId(cryptoWithoutRandomUuid);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
