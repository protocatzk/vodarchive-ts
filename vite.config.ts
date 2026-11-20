import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

const API_TARGET = process.env.VITE_API_TARGET || 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/frontend', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/voduploader': { target: API_TARGET, changeOrigin: true },
      '/upload': { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
      '/rss': { target: API_TARGET, changeOrigin: true },
      '/n8n': { target: API_TARGET, changeOrigin: true },
    },
  },
});
