import { StrictMode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import MyPage from '../../src/MyPage';

test('설정 창은 배경 스크롤을 잠그고 닫힐 때 프로필 버튼으로 초점을 돌린다', async () => {
  const trigger = document.createElement('button');
  document.body.append(trigger); trigger.focus();
  document.body.style.overflow = 'auto';
  const onClose = vi.fn();
  const view = render(<StrictMode><MyPage name="민준" onClose={onClose} sections={[
    { id: 'profile', label: '프로필 설정', content: <p>프로필 내용</p> },
    { id: 'guardian', label: '보호자 설정', content: <p>동의 관리</p> },
  ]} /></StrictMode>);
  expect(document.body.style.overflow).toBe('hidden');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '마이페이지 닫기' }));
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '보호자 설정' }));
  await userEvent.keyboard('{Tab}');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '마이페이지 닫기' }));
  await userEvent.click(screen.getByRole('button', { name: '보호자 설정' }));
  expect(screen.getByText('동의 관리')).toBeTruthy();
  expect(screen.queryByText('프로필 내용')).toBeNull();
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(onClose).toHaveBeenCalledOnce();
  view.unmount();
  expect(document.body.style.overflow).toBe('auto');
  expect(document.activeElement).toBe(trigger);
  trigger.remove(); document.body.style.overflow = '';
});
