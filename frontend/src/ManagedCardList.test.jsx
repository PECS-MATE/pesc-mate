import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import ManagedCardList from './ManagedCardList';
const items = Array.from({ length: 13 }, (_, i) => ({ id: `card-${i}`, label: `카드 ${i + 1}`,
  category: '음식', visibility: 'private', status: 'approved' }));

it('limits the visible list to twelve cards and supports the last page', async () => {
  render(<ManagedCardList items={items} total={13} isCaregiver />);
  expect(screen.getAllByRole('listitem')).toHaveLength(12);
  expect(screen.queryByText('카드 13')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '다음' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(screen.getByText('카드 13')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
});

it('opens the page containing the newly registered card', () => {
  render(<ManagedCardList items={items} total={13} isCaregiver focusId="card-12" />);
  expect(screen.getByText('카드 13')).toBeInTheDocument();
});

it('preserves draft edit and activation actions', async () => {
  const onEdit = vi.fn(), onSubmitDraft = vi.fn(), draft = { ...items[0], status: 'draft' };
  render(<ManagedCardList items={[draft]} total={1} isCaregiver onEdit={onEdit} onSubmitDraft={onSubmitDraft} />);
  await userEvent.click(screen.getByRole('button', { name: '수정' }));
  await userEvent.click(screen.getByRole('button', { name: '사용 시작' }));
  expect(onEdit).toHaveBeenCalledWith(draft);
  expect(onSubmitDraft).toHaveBeenCalledWith(draft);
});
