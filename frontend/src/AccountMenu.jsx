import { useEffect, useId, useRef, useState } from 'react';
import { Avatar } from './Profile';
import IconButton from './IconButton';
import UiIcon from './UiIcon';
import './assets/accountMenu.css';

export default function AccountMenu({ user, buttonRef, onProfile, onLogout, disabled }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null), menu = useRef(null), id = useId();
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector('button')?.focus();
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function close(focus = false) { setOpen(false); if (focus) buttonRef.current?.focus(); }
  function keys(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') { event.preventDefault(); close(true); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = [...menu.current.querySelectorAll('button:not(:disabled)')];
      if (!items.length) return;
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      items[next].focus();
    }
  }
  return <div ref={root} className="profile profile-trigger account-profile">
    <Avatar user={user} /><span><strong>{user.name}</strong></span>
    <IconButton ref={buttonRef} icon="settings" label="계정 메뉴 열기" className="profile-settings-icon"
      disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(current => !current)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }} />
    {open && <div ref={menu} id={id} className="account-menu-popup" role="menu" aria-label="계정 메뉴" onKeyDown={keys}>
      <button type="button" role="menuitem" tabIndex="-1" disabled={disabled} onClick={() => { close(); onProfile(); }}><UiIcon name="user" />프로필</button>
      <button type="button" role="menuitem" tabIndex="-1" disabled={disabled} onClick={() => { close(); onLogout(); }}><UiIcon name="logout" />로그아웃</button>
    </div>}
  </div>;
}
