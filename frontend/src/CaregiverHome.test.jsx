import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import CaregiverHome from './CaregiverHome';

it('does not show first-time linking instructions while connection data is unknown', () => {
  render(<CaregiverHome users={[]} pending offline accountId="synthetic" />);
  expect(screen.getByRole('status')).toHaveTextContent('연결 정보를 확인 중');
  expect(screen.queryByText('처음 연결하는 방법')).not.toBeInTheDocument();
});

it('shows linking instructions only after a confirmed empty result', () => {
  render(<CaregiverHome users={[]} pending={false} accountId="synthetic" />);
  expect(screen.getByText('처음 연결하는 방법')).toBeInTheDocument();
});

it('keeps the child visible but blocks management actions while offline', () => {
  const target = { id: 'one', name: '민준', permissions: ['cards_manage'] };
  render(<CaregiverHome users={[target]} target={target} pending offline onSelect={vi.fn()} />);
  expect(screen.getByRole('heading', { name: '민준님의 관리' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '개인 카드 관리' })).toBeDisabled();
  expect(screen.queryByText('처음 연결하는 방법')).not.toBeInTheDocument();
});
