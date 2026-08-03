import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
  },
  build: {
    target: 'es2020',
  },
  test: {
    environment: 'node',
    globals: true,
  },
});
