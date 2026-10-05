import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: { main: 'index.html', admin: 'admin.html' },
    },
  },
  test: { environment: 'node' },
});
