import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import App from './App';

it('renders the authentication flow and reports a failed login without retaining a token', async () => {
  render(<StrictMode><App /></StrictMode>);
  const username = await screen.findByRole('textbox', { name: '아이디' });
  await userEvent.clear(username); await userEvent.type(username, 'synthetic');
  const password = screen.getByLabelText('비밀번호');
  await userEvent.clear(password); await userEvent.type(password, 'synthetic-password');
  fetch.mockResolvedValue(new Response(JSON.stringify({ detail: '합성 로그인 거부' }), { status: 401 }));
  await userEvent.click(screen.getByRole('button', { name: '로그인', exact: true }));
  expect(await screen.findByText('합성 로그인 거부')).toBeInTheDocument();
  expect(localStorage.getItem('pesc-mate-token')).toBeNull();
  expect(fetch.mock.calls.some(([url, options]) => url === '/api/auth/login' && options.method === 'POST')).toBe(true);
});
it('clears a rejected restored session and returns to authentication', async () => {
  localStorage.setItem('pesc-mate-token', 'expired-synthetic');
  fetch.mockResolvedValue(new Response(JSON.stringify({ detail: 'expired' }), { status: 401 }));
  render(<App />);
  expect(await screen.findByRole('textbox', { name: '아이디' })).toBeInTheDocument();
  await waitFor(() => expect(localStorage.getItem('pesc-mate-token')).toBeNull());
});

it('shows two presentation children and the shared login password', async () => {
  render(<App />);
  expect(await screen.findByRole('textbox', { name: '아이디' })).toHaveValue('demo');
  expect(screen.getByLabelText('비밀번호')).toHaveValue('1234');
  expect(screen.getByText('demo2', { selector: 'code' })).toBeInTheDocument();
  expect(screen.getAllByText('1234', { selector: 'code' })).toHaveLength(5);
});
