import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import CardEditorDialog from './CardEditorDialog';
import { request } from './services/api';
vi.mock('./services/api', () => ({ request: vi.fn() }));

beforeEach(() => {
  request.mockReset();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  URL.createObjectURL = vi.fn(() => 'blob:synthetic-card');
  URL.revokeObjectURL = vi.fn();
});
const props = { privateOnly: true, targetId: 'child-two', targetName: '민준',
  categories: [{ id: 'food', name: '음식' }], onClose: vi.fn() };

it('generates for the selected child and submits the reviewed image as a private card', async () => {
  let saved;
  const onSubmit = vi.fn((event, image) => {
    event.preventDefault();
    saved = { visibility: new FormData(event.currentTarget).get('visibility'), image };
  });
  request.mockResolvedValueOnce({ generation_ready: true, generation_backend: 'gemini',
    generation_recipient: 'Google', model: 'gemini-2.5-flash-image', quota: { used: 0, limit: 30, remaining: 30 } })
    .mockResolvedValueOnce({ provider: 'Gemini', data_url: 'data:image/png;base64,YQ==',
      quota: { used: 1, limit: 30, remaining: 29 } });
  render(<CardEditorDialog {...props} onSubmit={onSubmit} />);
  await userEvent.type(screen.getByRole('textbox', { name: '카드명' }), '물컵');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '카테고리' }), '음식');
  await userEvent.click(screen.getByRole('button', { name: 'AI 그림 카드', exact: true }));
  await userEvent.click(screen.getByRole('button', { name: '사용 가능 여부 확인' }));
  expect(request.mock.calls[0][0]).toBe('/card-image-tools/status?scope=private&user_id=child-two');
  await userEvent.click(await screen.findByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: '카드 그림 생성' }));
  await userEvent.click(await screen.findByRole('button', { name: '확인하고 적용' }));
  expect(await screen.findByAltText('등록할 AI 그림 카드')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
  expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({ user_id: 'child-two', scope: 'private', category: '음식' });
  await userEvent.click(screen.getByRole('button', { name: '카드 저장', exact: true }));
  expect(saved.visibility).toBe('private');
  expect(saved.image).toBeInstanceOf(File);
});

it('does not expose the online generator while offline', () => {
  render(<CardEditorDialog {...props} ocrDisabled onSubmit={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'AI 그림 카드', exact: true })).toBeDisabled();
});
