import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const windowsChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const executablePath = process.env.PLAYWRIGHT_BROWSER_PATH
  || (process.platform === 'win32' && existsSync(windowsChrome) ? windowsChrome : undefined);

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results/artifacts',
  fullyParallel: false,
  timeout: 60000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.E2E_START_SERVERS === 'true' ? [
    {
      command: 'python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log',
      cwd: '../backend', url: 'http://127.0.0.1:8000/api/health',
      timeout: 60000, reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
      url: 'http://127.0.0.1:5173', timeout: 60000, reuseExistingServer: false,
    },
  ] : undefined,
});
