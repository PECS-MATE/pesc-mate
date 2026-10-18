import { test, expect } from './fixtures.js';
import { login } from './auth-helpers.js';

const accounts = {
  user: { username: 'demo', password: 'demo1234' },
  caregiver: { username: 'caregiver', password: 'caregiver1234' },
  support: { username: 'support', password: 'support1234' },
  operator: { username: 'admin', password: 'admin1234' },
};
const apiBaseUrl = process.env.E2E_API_BASE_URL || '';

test.describe('역할별 접근 경계', () => {
  test('AAC 사용자는 의사소통 메뉴만 보고 다른 아동 API에 접근하지 못한다', async ({ page }) => {
    await login(page, accounts.user);

    await expect(page.getByText('AAC 사용자', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /그림으로 말하기/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '연습하기', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /지원 홈/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /공용 콘텐츠 운영/ })).toHaveCount(0);

    const response = await page.evaluate(async baseUrl => {
      const token = localStorage.getItem('pesc-mate-token');
      const result = await fetch(`${baseUrl}/api/dashboard?user_id=another-child`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { status: result.status };
    }, apiBaseUrl);
    expect(response.status).toBe(403);
  });

  test('보호자는 지원 화면만 보고 운영 메뉴를 볼 수 없다', async ({ page }) => {
    await login(page, accounts.caregiver);

    await expect(page.getByText('보호자 계정', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /지원 홈/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /그림으로 말하기/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /공용 콘텐츠 운영/ })).toHaveCount(0);
  });

  test('일반 담당자는 콘텐츠 운영 메뉴를 볼 수 없다', async ({ page }) => {
    await login(page, accounts.support);

    await expect(page.getByText('지원 담당자 계정', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /지원 홈/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /공용 콘텐츠 운영/ })).toHaveCount(0);
  });

  test('운영 권한 담당자에게만 공용 콘텐츠 운영 메뉴가 표시된다', async ({ page }) => {
    await login(page, accounts.operator);

    await expect(page.getByText('운영 권한 담당자 계정', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /지원 홈/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /공용 콘텐츠 운영/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /그림으로 말하기/ })).toHaveCount(0);
  });
});
