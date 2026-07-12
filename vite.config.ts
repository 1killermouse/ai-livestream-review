import path from 'path';
import { defineConfig } from '@lark-apaas/fullstack-vite-preset';
import type { Plugin } from 'vite';

const standaloneLocalAuthPlugin: Plugin = {
  name: 'standalone-local-auth',
  enforce: 'pre',
  configureServer(server) {
    if (process.env.STANDALONE_LOCAL_DEV !== '1') {
      return undefined;
    }

    server.middlewares.use((request, response, next) => {
      const csrfToken = 'local-dev-csrf';
      const currentCookie = request.headers.cookie || '';
      if (!/(?:^|;\s*)suda-csrf-token=/.test(currentCookie)) {
        request.headers.cookie = currentCookie
          ? `${currentCookie}; suda-csrf-token=${csrfToken}`
          : `suda-csrf-token=${csrfToken}`;
        const localCookie = `suda-csrf-token=${csrfToken}; Path=/; SameSite=Lax`;
        const existingCookies = response.getHeader('Set-Cookie');
        response.setHeader(
          'Set-Cookie',
          existingCookies
            ? Array.isArray(existingCookies)
              ? [...existingCookies, localCookie]
              : [String(existingCookies), localCookie]
            : localCookie,
        );
      }
      request.headers['x-suda-csrf-token'] ||= csrfToken;
      next();
    });

    return undefined;
  },
};

export default defineConfig({
  plugins: [standaloneLocalAuthPlugin],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
    },
  },
});
