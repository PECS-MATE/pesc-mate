import { createRequestId } from './requestId.js';

const API_BASE_URL =
  import.meta.env?.VITE_API_BASE_URL ?? "";

const TOKEN_KEY = 'pesc-mate-token';

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
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function hasToken() {
  return Boolean(localStorage.getItem(TOKEN_KEY));
}

export async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = new Headers(isFormData ? {} : { 'Content-Type': 'application/json' });
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  new Headers(options.headers).forEach((value, name) => headers.set(name, value));
  const { response, requestId } = await fetchWithRequestId(`${API_BASE_URL}/api${path}`, {
    ...options,
    signal: AbortSignal.timeout(15000),
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

export async function requestBlob(path) {
  const token = localStorage.getItem(TOKEN_KEY);
  const { response, requestId } = await fetchWithRequestId(`${API_BASE_URL}${path}`, {
    signal: AbortSignal.timeout(15000),
    headers: token
      ? { Authorization: `Bearer ${token}` }
      : {},
  });
  if (!response.ok) throw await responseError(response, requestId, '이미지를 불러오지 못했습니다.', path, token ? `Bearer ${token}` : null);
  try {
    return await response.blob();
  } catch (error) {
    error.status = response.status;
    error.requestId = responseRequestId(response, requestId);
    throw error;
  }
}
