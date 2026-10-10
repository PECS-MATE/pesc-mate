import { createRequestId } from './requestId';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "";

const TOKEN_KEY = 'pesc-mate-token';
const DEVICE_KEY = 'pesc-mate-device-id';

function notifyAccessDenied(status) {
  if (status === 403) window.dispatchEvent(new Event('pesc-mate:access-denied'));
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function hasToken() {
  return Boolean(localStorage.getItem(TOKEN_KEY));
}

export async function recordDeviceAccess() {
  let deviceId;
  try {
    deviceId = localStorage.getItem(DEVICE_KEY);
    if (!deviceId) {
      deviceId = createRequestId();
      localStorage.setItem(DEVICE_KEY, deviceId);
    }
  } catch {
    deviceId = createRequestId();
  }
  await fetch(`${API_BASE_URL}/api/device/access`, {
    method: 'POST', keepalive: true, headers: { 'X-Pesc-Device': deviceId },
  });
}

export async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`${API_BASE_URL}/api${path}`, {
    ...options,
    signal: AbortSignal.timeout(15000),
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(localStorage.getItem(TOKEN_KEY) ? { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` } : {}),
      ...options.headers,
    },
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    notifyAccessDenied(response.status);
    const error = new Error(typeof data?.detail === 'string' ? data.detail : '요청을 처리하지 못했습니다.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function getHealth() {
  const response = await fetch(`${API_BASE_URL}/api/health`);

  if (!response.ok) {
    throw new Error("API 서버 상태를 확인할 수 없습니다.");
  }

  return response.json();
}

export async function requestBlob(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    signal: AbortSignal.timeout(15000),
    headers: localStorage.getItem(TOKEN_KEY)
      ? { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` }
      : {},
  });
  if (!response.ok) {
    notifyAccessDenied(response.status);
    const error = new Error('이미지를 불러오지 못했습니다.');
    error.status = response.status;
    throw error;
  }
  return response.blob();
}
