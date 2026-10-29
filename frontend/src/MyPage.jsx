import { useEffect, useId, useRef, useState } from 'react';
import UiIcon from './UiIcon';

const SECTION_DETAILS = {
  profile: { icon: 'user', description: '프로필 사진 선택' },
  accessibility: { icon: 'accessibility', description: '화면 표시와 움직임' },
  voice: { icon: 'volume', description: '목소리와 말하기 속도' },
  guardian: { icon: 'shield', description: '동의와 데이터 관리' },
  support: { icon: 'users', description: '연결 사용자와 운영' },
};

export default function MyPage({ name, sections, notice, error, onClose }) {
  const page = useRef(null);
  const heading = useRef(null);
  const contentPanel = useRef(null);
  const trigger = useRef(document.activeElement);
  const id = useId();
  const [section, setSection] = useState('profile');
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const current = sections.find(item => item.id === section) || sections[0];

  useEffect(() => {
    const currentPage = page.current;
    heading.current.focus();
    currentPage.scrollIntoView({ block: 'start' });
    return () => {
      requestAnimationFrame(() => {
        if (!currentPage.isConnected && document.activeElement === document.body && trigger.current?.isConnected) trigger.current.focus();
      });
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const change = () => setCompact(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  function selectSection(next) {
    setSection(next);
    if (contentPanel.current) contentPanel.current.scrollTop = 0;
  }

  function moveSection(event) {
    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = sections.findIndex(item => item.id === current.id);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1
      : (index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1) + sections.length) % sections.length;
    selectSection(sections[next].id);
    event.currentTarget.querySelectorAll('[role="tab"]')[next].focus();
  }

  return <section ref={page} id="my-page" className="my-page" aria-labelledby="my-page-title">
    <header className="my-page-heading"><span className="my-page-heading-icon" aria-hidden="true"><UiIcon name="settings" size={24} /></span>
      <div><h1 ref={heading} tabIndex="-1" id="my-page-title">마이페이지</h1><p>{name}님의 프로필과 설정</p></div>
      <button type="button" onClick={onClose}><UiIcon name="arrow-left" />이전 화면으로</button></header>
    <div className="my-page-layout">
      <div className="my-page-menu" role="tablist" aria-label="마이페이지 설정"
        aria-orientation={compact ? 'horizontal' : 'vertical'} onKeyDown={moveSection}>
        <p className="my-page-menu-title">설정 항목</p>
        {sections.map(item => <button type="button" role="tab" key={item.id} id={`${id}-${item.id}`}
          aria-selected={current.id === item.id} tabIndex={current.id === item.id ? 0 : -1}
          aria-controls="my-page-content" onClick={() => selectSection(item.id)}>
          <span className="my-page-menu-icon" aria-hidden="true"><UiIcon name={SECTION_DETAILS[item.id]?.icon || 'settings'} /></span>
          <span className="my-page-menu-copy"><strong>{item.label}</strong><small>{SECTION_DETAILS[item.id]?.description || '설정 관리'}</small></span>
          <UiIcon name="chevron-right" className="my-page-menu-arrow" />
        </button>)}
      </div>
      <div className="my-page-main" ref={contentPanel}>
        {notice && <p role="status">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div id="my-page-content" className="my-page-content" key={current.id} role="tabpanel"
          aria-labelledby={`${id}-${current.id}`} tabIndex="0">{current.content}</div>
      </div>
    </div>
  </section>;
}
