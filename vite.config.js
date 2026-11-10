import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** The API runs separately during development, so `/api` is proxied to it. */
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
    },
  },
});
