import { useEffect, useRef, useState } from 'react';

export default function useSidebar({ authReady, accountId, profileReady }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.matchMedia('(max-width: 1000px)').matches);
  const [compactSidebar, setCompactSidebar] = useState(() => window.matchMedia('(max-width: 1000px)').matches);
  const sidebarOpenRef = useRef(null);
  const sidebarCloseRef = useRef(null);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1000px)');
    const update = () => setCompactSidebar(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!authReady || !profileReady || !compactSidebar || sidebarCollapsed) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebarCloseRef.current?.focus({ preventScroll: true });
    document.addEventListener('keydown', handleSidebarKeyDown, true);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', handleSidebarKeyDown, true); };
  }, [authReady, accountId, profileReady, compactSidebar, sidebarCollapsed]);
  function toggleSidebar(collapsed) {
    setSidebarCollapsed(collapsed);
    window.requestAnimationFrame(() => (collapsed ? sidebarOpenRef : sidebarCloseRef).current?.focus({ preventScroll: true }));
  }
  function handleSidebarKeyDown(event) {
    if (!compactSidebar) return;
    if (event.target.closest('[role="menu"]')) return;
    if (event.key === 'Escape') { event.preventDefault(); toggleSidebar(true); return; }
    if (event.key !== 'Tab') return;
    const controls = [...document.getElementById('app-sidebar').querySelectorAll('button:not(:disabled), a[href], input, select, textarea, [tabindex="0"]')]
      .filter(control => control.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (!controls.includes(document.activeElement)) { event.preventDefault(); first?.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return { sidebarCollapsed, setSidebarCollapsed, compactSidebar, sidebarOpenRef, sidebarCloseRef, toggleSidebar };
}
