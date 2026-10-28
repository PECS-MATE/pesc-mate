import { useEffect, useRef, useState } from 'react';

export default function MyPage({ name, sections, notice, error, onClose }) {
  const dialog = useRef(null);
  const trigger = useRef(document.activeElement);
  const [section, setSection] = useState('profile');
  const current = sections.find(item => item.id === section) || sections[0];

  useEffect(() => {
    const modal = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modal.showModal();
    modal.querySelector('[data-mypage-close]').focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      // StrictMode probes cleanup while the same dialog is still mounted.
      if (!modal.isConnected && trigger.current?.isConnected) trigger.current.focus();
    };
  }, []);

  function keepFocusInside(event) {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.current.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
      .filter(control => !control.disabled && !control.hidden && control.tabIndex >= 0);
    const first = controls[0];
    const last = controls.at(-1);
    if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }

  return <dialog ref={dialog} className="my-page" aria-labelledby="my-page-title"
    onKeyDown={keepFocusInside}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="my-page-heading"><div><h2 id="my-page-title">마이페이지</h2><p>{name}님의 프로필과 설정</p></div>
      <button type="button" data-mypage-close aria-label="마이페이지 닫기" onClick={onClose}>닫기</button></header>
    <nav className="my-page-menu" aria-label="마이페이지 설정">
      {sections.map(item => <button type="button" key={item.id} aria-pressed={current.id === item.id}
        onClick={() => setSection(item.id)}>{item.label}</button>)}
    </nav>
    {notice && <p role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="my-page-content" key={current.id}>{current.content}</div>
  </dialog>;
}
