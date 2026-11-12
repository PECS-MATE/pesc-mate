import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import CardOcrAssist from './CardOcrAssist';
import { request } from './services/api';
vi.mock('./services/api', () => ({ request: vi.fn() }));
const image = () => new File(['synthetic'], 'card.png', { type: 'image/png' });
it('uploads to the selected account then passes the edited label to registration', async () => {
  request.mockResolvedValue({ suggested_label: '물', candidates: ['물'] }); const onApply = vi.fn();
  render(<CardOcrAssist file={image()} targetId="one" onApply={onApply} />);
  await userEvent.click(screen.getByRole('button', { name: '사진 글자 읽기' }));
  expect(request.mock.calls.at(-1)[0]).toBe('/cards/ocr');
  expect(request.mock.calls.at(-1)[1].body.get('user_id')).toBe('one');
  const input = await screen.findByRole('combobox', { name: '인식한 이름' });
  await userEvent.clear(input); await userEvent.type(input, '물 마시기');
  await userEvent.click(screen.getByRole('button', { name: '이 이름 사용' }));
  expect(onApply).toHaveBeenCalledWith('물 마시기');
});
it('shows an empty recognition result without applying a name', async () => {
  request.mockResolvedValue({ suggested_label: '', candidates: [] });
  render(<CardOcrAssist file={image()} targetId="one" onApply={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: '사진 글자 읽기' }));
  expect(await screen.findByText('글자를 찾지 못했어요. 이름을 직접 입력해 주세요.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '이 이름 사용' })).not.toBeInTheDocument();
});
it.each([new File(['bad'], 'bad.gif', { type: 'image/gif' }), new File([], 'empty.png', { type: 'image/png' }),
  new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })])('rejects an invalid upload before transport', async file => {
  request.mockClear(); render(<CardOcrAssist file={file} targetId="one" onApply={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: '사진 글자 읽기' }));
  expect(request).not.toHaveBeenCalled(); expect(screen.getByRole('status')).not.toBeEmptyDOMElement();
});
it('ignores recognition completed after changing the target account', async () => {
  let finish; request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const file = image(), onApply = vi.fn(), { rerender } = render(<CardOcrAssist file={file} targetId="one" onApply={onApply} />);
  await userEvent.click(screen.getByRole('button', { name: '사진 글자 읽기' }));
  rerender(<CardOcrAssist file={file} targetId="two" onApply={onApply} />);
  finish({ suggested_label: 'old', candidates: ['old'] });
  await waitFor(() => expect(screen.getByRole('button', { name: '사진 글자 읽기' })).toBeEnabled());
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument(); expect(onApply).not.toHaveBeenCalled();
});
