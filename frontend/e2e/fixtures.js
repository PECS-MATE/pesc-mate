import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const browserLogs = [];
    page.on('console', message => browserLogs.push(`[${message.type()}] ${message.text()}`));
    page.on('pageerror', error => browserLogs.push(`[pageerror] ${error.stack || error.message}`));

    await use(page);

    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('browser-console.txt', {
        body: Buffer.from(browserLogs.join('\n') || '브라우저 콘솔 출력 없음', 'utf8'),
        contentType: 'text/plain',
      });
    }
  },
});

export { expect };
