import { useEffect, useRef } from 'react';
import MyPage from './MyPage';

export default function AccountSettingsDialog({ returnFocus, ...props }) {
  const modal = useRef(null), restoreFocus = useRef(returnFocus);
  restoreFocus.current = returnFocus;
  useEffect(() => {
    const dialog = modal.current;
    dialog.showModal();
    dialog.querySelector('h1')?.focus({ preventScroll: true });
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close(); document.body.style.overflow = previous;
      requestAnimationFrame(() => restoreFocus.current?.()?.focus());
    };
  }, []);
  return <dialog ref={modal} className="account-settings-dialog" aria-label="프로필과 설정"
    onCancel={event => { event.preventDefault(); props.onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) props.onClose();
    } }}><MyPage {...props} modal /></dialog>;
}
