import axios from 'axios';

const CLIENT_BASE_PATH = process.env.CLIENT_BASE_PATH || '/';
const INTERNAL_SESSION_KEY = 'zhibo_internal_session';

export function setInternalSessionToken(token: string): void {
  window.sessionStorage.setItem(INTERNAL_SESSION_KEY, token);
}

export function clearInternalSessionToken(): void {
  window.sessionStorage.removeItem(INTERNAL_SESSION_KEY);
}

export const apiClient = axios.create({
  baseURL: CLIENT_BASE_PATH,
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const csrfToken = (window as Window & { csrfToken?: string }).csrfToken;

  if (csrfToken) {
    config.headers.set('X-Suda-Csrf-Token', csrfToken);
  }
  config.headers.set('X-Page-Route', window.location.pathname);
  const internalSessionToken: string | null =
    window.sessionStorage.getItem(INTERNAL_SESSION_KEY);
  if (internalSessionToken) {
    config.headers.set('X-Internal-Session', internalSessionToken);
  }

  return config;
});
