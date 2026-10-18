import assert from 'node:assert/strict';
import { afterEach, beforeEach } from 'node:test';
import test from 'node:test';

import { recordDeviceAccess, request, requestBlob } from '../src/services/api.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const originalGlobals = new Map(['fetch', 'localStorage', 'window'].map(name =>
  [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
let storage;
let events;

beforeEach(() => {
  storage = new Map([['pesc-mate-token', 'account-token']]);
  events = [];
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, value: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true, value: { dispatchEvent: event => events.push(event.type) },
  });
});

afterEach(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function mockResponses(...responses) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    assert.ok(response, 'unexpected fetch call');
    return response;
  };
  return calls;
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });
}

test('forbidden events identify the API scope without changing the error result', async () => {
  let denied;
  window.dispatchEvent = event => { denied = event; };
  mockResponses(jsonResponse({ detail: '재인증을 확인해 주세요.' }, 403));
  await assert.rejects(request('/admin/accounts/staff/content-permission'), error => error.status === 403);
  assert.equal(denied.type, 'pesc-mate:access-denied');
  assert.equal(denied.apiPath, '/admin/accounts/staff/content-permission');
});

test('each retry has a fresh transport UUID while preserving the idempotency body and header overrides', async () => {
  const calls = mockResponses(jsonResponse({ saved: true }), jsonResponse({ saved: true }));
  const body = JSON.stringify({ request_id: 'body-idempotency-id', cards: ['water'] });
  const headers = new Headers({
    Authorization: 'Bearer explicit-token', 'Content-Type': 'application/custom+json',
    'X-Custom': 'custom-value', 'X-Request-ID': 'caller-value',
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.deepEqual(await request('/sentence', { method: 'POST', body, headers }), { saved: true });
  }
  const ids = calls.map(call => call.headers.get('X-Request-ID'));
  ids.forEach(id => assert.match(id, uuidPattern));
  assert.notEqual(ids[0], ids[1]);
  for (const call of calls) {
    assert.equal(call.url, '/api/sentence');
    assert.equal(call.method, 'POST');
    assert.equal(call.body, body);
    assert.equal(call.headers.get('Authorization'), 'Bearer explicit-token');
    assert.equal(call.headers.get('Content-Type'), 'application/custom+json');
    assert.equal(call.headers.get('X-Custom'), 'custom-value');
    assert.ok(call.signal instanceof AbortSignal);
  }
  assert.equal(headers.get('X-Request-ID'), 'caller-value');
});

test('multipart uploads keep their browser boundary and authentication', async () => {
  const calls = mockResponses(jsonResponse({ uploaded: true }));
  const body = new FormData();
  body.append('image', new Blob(['image-bytes'], { type: 'image/png' }), 'card.png');
  await request('/cards/submissions', { method: 'POST', body, headers: { 'X-Custom': 'upload' } });
  assert.equal(calls[0].body, body);
  assert.equal(calls[0].headers.has('Content-Type'), false);
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer account-token');
  assert.equal(calls[0].headers.get('X-Custom'), 'upload');
  assert.match(calls[0].headers.get('X-Request-ID'), uuidPattern);
});

test('204 responses succeed without attempting to decode JSON', async () => {
  const calls = mockResponses(new Response(null, { status: 204 }));
  assert.equal(await request('/support/links/person', { method: 'DELETE' }), null);
  assert.match(calls[0].headers.get('X-Request-ID'), uuidPattern);
});

test('structured HTTP errors retain server correlation, legacy detail, and error code', async () => {
  mockResponses(jsonResponse({
    detail: '기존 오류 안내',
    error: { code: 'conflict', message: '새 오류 안내', request_id: 'body-response-id' },
  }, 409, { 'X-Request-ID': 'header-response-id' }));
  await assert.rejects(request('/cards'), error => {
    assert.equal(error.message, '기존 오류 안내');
    assert.equal(error.status, 409);
    assert.equal(error.requestId, 'header-response-id');
    assert.equal(error.code, 'conflict');
    return true;
  });
});

test('structured validation errors work with legacy detail lists and body correlation fallback', async () => {
  mockResponses(jsonResponse({
    detail: [{ loc: ['body', 'label'], msg: 'required' }],
    error: { code: 'validation_error', message: '입력 내용을 확인해 주세요.', request_id: 'body-response-id' },
  }, 422));
  await assert.rejects(request('/cards'), error => {
    assert.equal(error.message, '입력 내용을 확인해 주세요.');
    assert.equal(error.status, 422);
    assert.equal(error.requestId, 'body-response-id');
    assert.equal(error.code, 'validation_error');
    return true;
  });
});

test('HTML proxy failures preserve Korean fallbacks, sent correlation, and access-denied events', async () => {
  const calls = mockResponses(
    new Response('<h1>Forbidden</h1>', { status: 403 }),
    new Response(null, { status: 403 }),
  );
  await assert.rejects(request('/cards'), error => {
    assert.equal(error.message, '요청을 처리하지 못했습니다.');
    assert.equal(error.status, 403);
    assert.equal(error.requestId, calls[0].headers.get('X-Request-ID'));
    return true;
  });
  await assert.rejects(requestBlob('/api/profile/image'), error => {
    assert.equal(error.message, '이미지를 불러오지 못했습니다.');
    assert.equal(error.status, 403);
    assert.equal(error.requestId, calls[1].headers.get('X-Request-ID'));
    return true;
  });
  assert.deepEqual(events, ['pesc-mate:access-denied', 'pesc-mate:access-denied']);
});

test('binary images remain intact and use authenticated correlated requests', async () => {
  const bytes = new Uint8Array([0, 255, 137, 80]);
  const calls = mockResponses(new Response(bytes, { headers: { 'Content-Type': 'image/png' } }));
  const image = await requestBlob('/api/profile/image');
  assert.equal(image.type, 'image/png');
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), bytes);
  assert.equal(calls[0].url, '/api/profile/image');
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer account-token');
  assert.equal(calls[0].headers.has('Content-Type'), false);
  assert.match(calls[0].headers.get('X-Request-ID'), uuidPattern);
  assert.ok(calls[0].signal instanceof AbortSignal);
});

test('image errors read structured server failures without decoding the image as JSON', async () => {
  mockResponses(jsonResponse({
    error: { code: 'not_found', message: '이미지를 찾을 수 없습니다.', request_id: 'image-response-id' },
  }, 404));
  await assert.rejects(requestBlob('/api/profile/image'), error => {
    assert.equal(error.message, '이미지를 찾을 수 없습니다.');
    assert.equal(error.status, 404);
    assert.equal(error.requestId, 'image-response-id');
    assert.equal(error.code, 'not_found');
    return true;
  });
});

test('device access retains its device identity across fresh transport IDs and reports HTTP failures', async () => {
  const calls = mockResponses(
    new Response(null, { status: 204 }),
    jsonResponse({ detail: '기기 접근 오류' }, 503, { 'X-Request-ID': 'device-response-id' }),
  );
  assert.equal(await recordDeviceAccess(), undefined);
  await assert.rejects(recordDeviceAccess(), error => {
    assert.equal(error.message, '기기 접근 오류');
    assert.equal(error.status, 503);
    assert.equal(error.requestId, 'device-response-id');
    return true;
  });
  const deviceId = storage.get('pesc-mate-device-id');
  assert.match(deviceId, uuidPattern);
  assert.notEqual(calls[0].headers.get('X-Request-ID'), calls[1].headers.get('X-Request-ID'));
  for (const call of calls) {
    assert.equal(call.url, '/api/device/access');
    assert.equal(call.method, 'POST');
    assert.equal(call.keepalive, true);
    assert.equal(call.headers.get('X-Pesc-Device'), deviceId);
    assert.equal(call.headers.has('Authorization'), false);
    assert.match(call.headers.get('X-Request-ID'), uuidPattern);
    assert.notEqual(call.headers.get('X-Request-ID'), deviceId);
  }
});

test('network failures retain the sent transport ID on all request paths', async () => {
  const failures = [new TypeError('fetch failed'), new TypeError('image fetch failed'), new TypeError('device fetch failed')];
  const calls = mockResponses(...failures);
  const actions = [() => request('/cards'), () => requestBlob('/api/profile/image'), () => recordDeviceAccess()];
  for (const [index, action] of actions.entries()) {
    await assert.rejects(action, error => {
      assert.equal(error, failures[index]);
      assert.equal(error.requestId, calls[index].headers.get('X-Request-ID'));
      assert.match(error.requestId, uuidPattern);
      return true;
    });
  }
});

test('invalid JSON on a successful response retains status and response correlation', async () => {
  mockResponses(new Response('not JSON', { status: 200, headers: { 'X-Request-ID': 'invalid-response-id' } }));
  await assert.rejects(request('/cards'), error => {
    assert.ok(error instanceof SyntaxError);
    assert.equal(error.status, 200);
    assert.equal(error.requestId, 'invalid-response-id');
    return true;
  });
});
