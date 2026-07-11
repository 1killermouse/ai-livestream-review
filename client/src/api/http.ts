import axios from 'axios';

const CLIENT_BASE_PATH = process.env.CLIENT_BASE_PATH || '/';

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

  return config;
});
