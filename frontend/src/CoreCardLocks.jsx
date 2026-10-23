import { useEffect, useRef, useState } from 'react';
import { request } from './services/api';

export default function CoreCardLocks({ layout, targetId, disabled, onSaved, onRefresh }) {
  const [ids, setIds] = useState(layout.locked_card_ids || []);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false); const running = useRef(false);
  const identity = `${targetId}:${layout.revision}`;
  const current = useRef(identity); current.current = identity;
  const allowed = useRef(!disabled); allowed.current = !disabled;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setIds(layout.locked_card_ids || []); setConfirmed(false); setRefreshRequired(false); setError('');
  }, [identity]);
  useEffect(() => { if (disabled && running.current) setRefreshRequired(true); }, [disabled]);
  const changed = JSON.stringify([...ids].sort()) !== JSON.stringify([...(layout.locked_card_ids || [])].sort());
  const unavailable = (layout.locked_card_ids || []).filter(id => !layout.slots.some(slot => slot.card_id === id));
  const choices = [...layout.slots.map(slot => slot.card_id), ...unavailable];
  const byId = new Map((layout.available_cards || []).map(card => [card.id, card]));
  async function save() {
    if (running.current || disabled || refreshRequired || !confirmed || !changed || !navigator.onLine) return;
    const token = localStorage.getItem('pesc-mate-token'); if (!token) return;
    const scope = identity;
    const isCurrent = () => mounted.current && current.current === scope && allowed.current
      && navigator.onLine && localStorage.getItem('pesc-mate-token') === token;
    running.current = true; setBusy(true); setError('');
    try {
      const saved = await request(`/board/layout/locks?user_id=${encodeURIComponent(targetId)}`, {
        method: 'PUT', body: JSON.stringify({ expected_revision: layout.revision, card_ids: ids }),
      });
      if (!isCurrent()) return;
      // A confirmed write must not be retried even if the parent refresh fails.
      setRefreshRequired(true); setConfirmed(false);
      try { await onSaved(saved); }
      catch { if (isCurrent()) setError('잠금은 저장됐습니다. 최신 카드판을 확인해 주세요.'); }
    } catch (failure) {
      if (isCurrent()) { setError(failure.message); setConfirmed(false); setRefreshRequired(true); }
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  return <article aria-label="핵심 카드 잠금 관리"><h3>핵심 카드 잠금</h3>
    <p>아래는 현재 저장된 슬롯입니다. 잠그면 카드 위치·제외·사진 교체를 막습니다. 해제해도 카드나 기록은 삭제하지 않습니다. 다른 편집 내용은 함께 저장하지 않습니다.</p>
    <fieldset disabled={disabled || busy || refreshRequired}><legend>잠글 핵심 카드 선택</legend>
      {choices.map(id => <label key={id}><input type="checkbox" checked={ids.includes(id)} onChange={event => {
        setIds(previous => event.target.checked ? [...previous, id] : previous.filter(value => value !== id)); setConfirmed(false);
      }} />{byId.get(id)?.label || '사용 불가 카드'}{unavailable.includes(id) ? ' · 해제 필요' : ''}</label>)}
      <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />잠금 또는 해제가 사진·위치 보호에 미치는 영향을 확인했습니다</label>
      <button type="button" disabled={!confirmed || !changed} onClick={save}>{busy ? '저장 중…' : '핵심 잠금 저장'}</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    {refreshRequired && <button type="button" disabled={busy || disabled} onClick={onRefresh}>최신 잠금·카드판 확인</button>}
  </article>;
}
