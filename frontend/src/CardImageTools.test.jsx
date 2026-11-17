import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import CardImageTools from './CardImageTools';
import { request } from './services/api';
vi.mock('./services/api', () => ({ request: vi.fn() }));
const config = { generation_ready: true, generation_backend: 'gemini', model: 'gemini-2.5-flash-image',
  generation_provider: 'Gemini', generation_recipient: 'Google', quota: { used: 0, limit: 30, remaining: 30 } };
beforeEach(() => request.mockReset());

it('requires consent, previews the result, and only applies after confirmation', async () => {
  const onApply = vi.fn();
  request.mockResolvedValueOnce(config).mockResolvedValueOnce({ provider: 'Gemini',
    data_url: 'data:image/png;base64,YQ==', quota: { used: 1, limit: 30, remaining: 29 } });
  render(<CardImageTools admin initialOpen label="물컵" onApply={onApply} />);
  await userEvent.click(screen.getByRole('button', { name: '사용 가능 여부 확인' }));
  await screen.findByText(/남은 횟수 30회/);
  const generate = screen.getByRole('button', { name: '카드 그림 생성' });
  expect(generate).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox', { name: /그림 설명/ }), '파란 컵');
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(generate);
  await screen.findByAltText('적용 전 이미지 결과');
  expect(onApply).not.toHaveBeenCalled();
  expect(JSON.parse(request.mock.calls[1][1].body).description).toBe('파란 컵');
  await userEvent.click(screen.getByRole('button', { name: '확인하고 적용' }));
  await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
});

it('blocks generation when the shared daily quota is exhausted', async () => {
  request.mockResolvedValue({ ...config, quota: { used: 30, limit: 30, remaining: 0 } });
  render(<CardImageTools admin initialOpen label="물" onApply={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: '사용 가능 여부 확인' }));
  await screen.findByText(/남은 횟수 0회/);
  await userEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: '카드 그림 생성' })).toBeDisabled();
  expect(request).toHaveBeenCalledOnce();
});
