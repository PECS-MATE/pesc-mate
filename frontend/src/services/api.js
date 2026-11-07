import { createRequestId } from './requestId.js';
import { createSpeechAudioQueue } from './speechAudioQueue.js';

const API_BASE_URL =
  import.meta.env?.VITE_API_BASE_URL ?? "";

const TOKEN_KEY = 'pesc-mate-token';
const speechAudioQueue = createSpeechAudioQueue({ fetchAudio: fetchSpeechAudio,
  getSession: () => localStorage.getItem(TOKEN_KEY) });

function notifyAccessDenied(status, path, authorization) {
  if (status === 403) {
    const event = new Event('pesc-mate:access-denied');
    event.apiPath = path;
    window.dispatchEvent(event);
  }
  // Ignore anonymous auth failures and late failures from a replaced session.
  const token = localStorage.getItem(TOKEN_KEY);
  if (status === 401 && token && authorization === `Bearer ${token}`
    && !/^\/(?:api\/)?auth\/(?:login|register|logout)(?:\?|$)/.test(path)) {
    const event = new Event('pesc-mate:session-expired');
    event.apiPath = path;
    window.dispatchEvent(event);
  }
}

function responseRequestId(response, sentRequestId, data) {
  return response.headers.get('X-Request-ID') || data?.error?.request_id || sentRequestId;
}

async function fetchWithRequestId(url, options) {
  const requestId = createRequestId();
  const headers = new Headers(options.headers);
  headers.set('X-Request-ID', requestId);
  try {
    return { response: await fetch(url, { ...options, headers }), requestId };
  } catch (error) {
    error.requestId = requestId;
    throw error;
  }
}

async function responseError(response, requestId, fallbackMessage, path, authorization) {
  let data;
  try { data = await response.json(); } catch { /* Proxies may return HTML or an empty body. */ }
  notifyAccessDenied(response.status, path, authorization);
  const error = new Error(typeof data?.detail === 'string' ? data.detail
    : typeof data?.error?.message === 'string' ? data.error.message : fallbackMessage);
  error.status = response.status;
  error.requestId = responseRequestId(response, requestId, data);
  if (typeof data?.error?.code === 'string') error.code = data.error.code;
  return error;
}

export function setToken(token) {
  speechAudioQueue.reset();
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function hasToken() {
  return Boolean(localStorage.getItem(TOKEN_KEY));
}

export async function request(path, options = {}) {
  const { timeoutMs = 15000, ...requestOptions } = options;
  const isFormData = options.body instanceof FormData;
  const headers = new Headers(isFormData ? {} : { 'Content-Type': 'application/json' });
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  new Headers(options.headers).forEach((value, name) => headers.set(name, value));
  const { response, requestId } = await fetchWithRequestId(`${API_BASE_URL}/api${path}`, {
    ...requestOptions,
    signal: AbortSignal.timeout(timeoutMs),
    headers,
  });
  if (!response.ok) throw await responseError(response, requestId, '요청을 처리하지 못했습니다.', path, headers.get('Authorization'));
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch (error) {
    error.status = response.status;
    error.requestId = responseRequestId(response, requestId);
    throw error;
  }
}

export async function requestBlob(path, fallbackMessage = '이미지를 불러오지 못했습니다.') {
  const token = localStorage.getItem(TOKEN_KEY);
  const { response, requestId } = await fetchWithRequestId(`${API_BASE_URL}${path}`, {
    signal: AbortSignal.timeout(15000),
    headers: token
      ? { Authorization: `Bearer ${token}` }
      : {},
  });
  if (!response.ok) throw await responseError(response, requestId, fallbackMessage, path, token ? `Bearer ${token}` : null);
  try {
    return await response.blob();
  } catch (error) {
    error.status = response.status;
    error.requestId = responseRequestId(response, requestId);
    throw error;
  }
}

export function requestSpeechAudio(text, rate, signal) {
  return speechAudioQueue.request(text, rate, signal);
}

async function fetchSpeechAudio(text, rate, signal, token) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 50000);
  try {
    const { response, requestId } = await fetchWithRequestId(`${API_BASE_URL}/api/tts/speech`, {
      method: 'POST', signal: controller.signal, cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ text, rate }),
    });
    if (!response.ok) throw await responseError(response, requestId, '로컬 음성 서버를 확인해 주세요.', '/tts/speech', token ? `Bearer ${token}` : null);
    const blob = await response.blob();
    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (blob.size > 12 * 1024 * 1024 || String.fromCharCode(...header.slice(0, 4)) !== 'RIFF'
      || String.fromCharCode(...header.slice(8, 12)) !== 'WAVE') throw new Error('음성 서버의 응답 형식이 올바르지 않습니다.');
    if (signal?.aborted || localStorage.getItem(TOKEN_KEY) !== token) throw new DOMException('Cancelled', 'AbortError');
    const wav = blob.slice(0, blob.size, 'audio/wav');
    return wav;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
  }
}
