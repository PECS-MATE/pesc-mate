import { useEffect, useRef, useState } from 'react';

const SECTION_DETAILS = {
  profile: { icon: '●', description: '사진과 기본 정보' },
  accessibility: { icon: 'Aa', description: '화면 표시와 움직임' },
  voice: { icon: '♪', description: '목소리와 말하기 속도' },
  guardian: { icon: '◆', description: '동의와 데이터 관리' },
  support: { icon: '▦', description: '연결 사용자와 운영' },
};

export default function MyPage({ name, sections, notice, error, onClose }) {
  const dialog = useRef(null);
  const contentPanel = useRef(null);
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
    <header className="my-page-heading"><span className="my-page-heading-icon" aria-hidden="true">⚙</span>
      <div><h2 id="my-page-title">마이페이지</h2><p>{name}님의 프로필과 설정</p></div>
      <button type="button" data-mypage-close aria-label="마이페이지 닫기" onClick={onClose}>닫기</button></header>
    <div className="my-page-layout">
      <nav className="my-page-menu" aria-label="마이페이지 설정">
        <p className="my-page-menu-title">설정 항목</p>
        {sections.map(item => <button type="button" key={item.id} aria-pressed={current.id === item.id}
          aria-controls="my-page-content" onClick={() => { setSection(item.id); contentPanel.current.scrollTop = 0; }}>
          <span className="my-page-menu-icon" aria-hidden="true">{SECTION_DETAILS[item.id]?.icon || '⚙'}</span>
          <span className="my-page-menu-copy"><strong>{item.label}</strong><small>{SECTION_DETAILS[item.id]?.description || '설정 관리'}</small></span>
          <span className="my-page-menu-arrow" aria-hidden="true">›</span>
        </button>)}
      </nav>
      <div className="my-page-main" ref={contentPanel}>
        {notice && <p role="status">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div id="my-page-content" className="my-page-content" key={current.id}>{current.content}</div>
      </div>
    </div>
  </dialog>;
}
