import { useEffect, useRef, useState } from 'react';
import { request } from './services/api';
import BoardSlotsEditor from './BoardSlotsEditor';

export default function BoardOrganizationSuggestions({ layout, targetId, disabled, onSaved, onRefresh }) {
  const [feed, setFeed] = useState(null);
  const [draft, setDraft] = useState(null);
  const [name, setName] = useState('');
  const [ids, setIds] = useState([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [message, setMessage] = useState('');
  const alive = useRef(false);
  const running = useRef(false);
  const epoch = useRef(0);
  const identity = `${targetId}:${layout.revision}`;
  const current = useRef(identity); current.current = identity;
  const allowed = useRef(!disabled); allowed.current = !disabled;
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current += 1; }; }, []);
  useEffect(() => {
    epoch.current += 1; setFeed(null); setDraft(null); setConfirmed(false);
    setNeedsRefresh(false);
  }, [identity]);
  useEffect(() => {
    epoch.current += 1; setFeed(null); setDraft(null); setConfirmed(false);
    if (disabled && running.current) setNeedsRefresh(true);
  }, [disabled]);
  const cards = new Map((layout.available_cards || []).map(card => [card.id, card]));
  const full = (layout.situations || []).length >= (layout.max_situations || 6);
  const duplicateName = (layout.situations || []).some(item =>
    item.name.normalize('NFC').toLocaleLowerCase() === name.trim().normalize('NFC').toLocaleLowerCase());

  function begin() {
    if (running.current || disabled || !navigator.onLine) return null;
    const token = localStorage.getItem('pesc-mate-token');
    if (!token) return null;
    const scope = identity; const version = epoch.current;
    running.current = true; setBusy(true); setMessage('');
    return () => alive.current && current.current === scope && allowed.current
      && epoch.current === version && navigator.onLine && localStorage.getItem('pesc-mate-token') === token;
  }

  async function load() {
    if (needsRefresh) return;
    const valid = begin(); if (!valid) return;
    setFeed(null); setDraft(null); setConfirmed(false);
    try {
      const result = await request(`/board/layout/organization-suggestions?user_id=${encodeURIComponent(targetId)}`);
      if (!valid()) return;
      if (result.user_id !== targetId || result.layout_revision !== layout.revision) {
        setNeedsRefresh(true); setMessage('카드판이 변경되었습니다. 최신 카드판을 확인해 주세요.'); return;
      }
      setFeed(result);
    } catch (error) { if (valid()) setMessage(error.message); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }

  function choose(candidate) {
    if (disabled || busy || needsRefresh) return;
    setDraft(candidate); setName(candidate.name); setIds([...candidate.card_ids]); setConfirmed(false);
  }

  async function save() {
    if (!draft || !confirmed || !name.trim() || duplicateName || full || needsRefresh) return;
    const valid = begin(); if (!valid) return;
    try {
      const saved = await request(`/board/layout/situations?user_id=${encodeURIComponent(targetId)}`, {
        method: 'PUT', body: JSON.stringify({ operation: 'create', name: name.trim(),
          card_ids: ids, expected_revision: layout.revision }),
      });
      if (!valid()) return;
      setNeedsRefresh(true); setConfirmed(false);
      setMessage('검토한 새 카드판을 저장했습니다. 기본 카드판과 기존 상황은 그대로 유지됩니다.');
      await onSaved(saved);
    } catch (error) {
      if (valid()) {
        setMessage(error.message); setConfirmed(false);
        if (error.status !== 422) setNeedsRefresh(true);
      }
    } finally { running.current = false; if (alive.current) setBusy(false); }
  }

  async function refresh() {
    const valid = begin(); if (!valid) return;
    const token = localStorage.getItem('pesc-mate-token');
    try {
      await onRefresh();
      // The parent disables this panel while refreshing. No private response is reused here.
      if (alive.current && localStorage.getItem('pesc-mate-token') === token) {
        setNeedsRefresh(false); setFeed(null); setDraft(null);
      }
    } catch (error) { if (valid()) setMessage(error.message); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }

  return <article className="board-organization-suggestions" aria-label="보호자용 활동별 카드판 추천">
    <h3>자주 쓰는 카드로 카드판 추천</h3>
    <p>최근 30일의 성공한 발화 기록으로 활동별 묶음을 제안합니다. 공용 카테고리나 아동의 카드 위치를 자동으로 바꾸지 않습니다.</p>
    <p className="muted">이용 기록 동의와 기록 조회·카드판 관리 권한이 필요합니다. 사용 횟수는 선호·의도·능력 평가가 아닙니다.</p>
    <button type="button" disabled={disabled || busy || needsRefresh} onClick={load}>
      {busy ? '처리 중…' : '사용 기록으로 카드판 추천 받기'}</button>
    {disabled ? <p role="status">온라인 연결과 현재 사용자·권한을 확인한 뒤 추천을 볼 수 있습니다.</p> : <>
      {feed && <>
        <p role="status">{feed.notice}</p>
        {feed.personal_history_used && <p className="muted">중복 선택 재생을 제외한 발화 {feed.sampled_events}건 참고
          {feed.truncated ? ` · 최근 ${feed.sample_limit}개 기록만 표본으로 사용` : ''}. 실제 활동은 추정하지 않습니다.</p>}
        <div className="config-card-options">{feed.candidates.map(candidate => <button type="button" key={candidate.id}
          aria-pressed={draft?.id === candidate.id} disabled={busy || needsRefresh} onClick={() => choose(candidate)}>
          {candidate.name} · 카드 {candidate.card_ids.length}장 · 근거 발화 {candidate.event_count}건</button>)}</div>
      </>}
      {full && <p role="status">상황별 카드판은 최대 {layout.max_situations || 6}개입니다. 기존 카드판을 덮어쓰지 않습니다.</p>}
      {draft && <fieldset disabled={busy || needsRefresh}>
        <legend>추천 초안 검토 — 아직 저장하지 않았습니다</legend>
        <p>{draft.reason}에서 반복 사용한 카드를 제안했습니다. 기존 상대 순서를 유지하고 핵심 잠금 앞의 카드도 함께 포함할 수 있습니다.</p>
        <ul>{draft.cards.map(item => <li key={item.card_id}>{cards.get(item.card_id)?.label || '사용 불가 카드'}
          {' · '}근거 발화 {item.usage_count}건{item.included_for_position ? ' · 핵심 잠금 위치 유지를 위해 포함' : ''}</li>)}</ul>
        <label>새 카드판 이름<input value={name} maxLength={30} onChange={event => {
          setName(event.target.value); setConfirmed(false);
        }} /></label>
        <p className="muted">이름에 아동 이름·진단 등 개인정보를 넣지 마세요.</p>
        {duplicateName && <p role="alert">같은 이름의 카드판이 있습니다. 다른 이름으로 바꿔 주세요.</p>}
        <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
          이름·카드·순서를 확인했고 새 상황별 카드판으로 저장하겠습니다</label>
        <BoardSlotsEditor layout={layout} value={ids} onChange={value => { setIds(value); setConfirmed(false); }}
          onSave={save} busy={busy} title="추천 카드 선택·순서 수정" label="추천 초안 카드 편집"
          saveLabel="검토한 초안을 새 카드판으로 저장" saveDisabled={!confirmed || !name.trim() || duplicateName || full} />
        <button type="button" onClick={() => { setDraft(null); setConfirmed(false); }}>초안 버리기</button>
      </fieldset>}
    </>}
    {message && <p role="status">{message}</p>}
    {needsRefresh && <button type="button" disabled={disabled || busy} onClick={refresh}>최신 카드판 확인</button>}
  </article>;
}
