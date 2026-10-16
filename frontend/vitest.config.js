import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['test/components/**/*.test.jsx'],
    setupFiles: ['test/components/setup.js'],
    clearMocks: true,
    restoreMocks: true,
  },
});
