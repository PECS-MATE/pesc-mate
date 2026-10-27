import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Bound jsdom processes on the local Docker host; keep isolation and the test deadlines.
    maxWorkers: 2,
    include: ['test/components/**/*.test.jsx'],
    setupFiles: ['test/components/setup.js'],
    clearMocks: true,
    restoreMocks: true,
  },
});
