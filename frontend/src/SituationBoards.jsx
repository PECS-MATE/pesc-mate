import { useEffect, useRef, useState } from 'react';
import { request } from './services/api';
import BoardSlotsEditor from './BoardSlotsEditor';

export default function SituationBoards({ layout, targetId, disabled, onSaved, onRefresh }) {
  const situations = layout.situations || [];
  const [sourceId, setSourceId] = useState('default');
  const [newName, setNewName] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const selected = situations.find(item => item.id === selectedId);
  const [editName, setEditName] = useState('');
  const [slots, setSlots] = useState([]);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [confirmEdit, setConfirmEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(false); const running = useRef(false);
  const identity = `${targetId}:${layout.revision}`;
  const current = useRef(identity); current.current = identity;
  const allowed = useRef(!disabled); allowed.current = !disabled;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setConfirmCreate(false); setConfirmEdit(false); setConfirmDelete(false); setNeedsRefresh(false); setMessage('');
    setEditName(selected?.name || ''); setSlots((selected?.slots || []).map(slot => slot.card_id));
    if (selectedId && !selected) setSelectedId('');
    if (sourceId !== 'default' && !situations.some(item => item.id === sourceId)) setSourceId('default');
  }, [identity, selectedId]);
  useEffect(() => { if (disabled && running.current) setNeedsRefresh(true); }, [disabled]);
  const byId = new Map((layout.available_cards || []).map(card => [card.id, card.label]));
  const source = sourceId === 'default' ? layout : situations.find(item => item.id === sourceId);

  async function save(operation) {
    if (running.current || disabled || needsRefresh || !navigator.onLine) return;
    if ((operation === 'create' || operation === 'copy') && (!confirmCreate || !newName.trim())) return;
    if (operation === 'update' && (!confirmEdit || !selected || !editName.trim())) return;
    if (operation === 'delete' && (!confirmDelete || !selected)) return;
    const token = localStorage.getItem('pesc-mate-token'); if (!token) return;
    const scope = identity;
    const isCurrent = () => mounted.current && current.current === scope && allowed.current
      && navigator.onLine && localStorage.getItem('pesc-mate-token') === token;
    const body = { expected_revision: layout.revision, operation };
    if (operation === 'create' || operation === 'copy') {
      body.name = newName.trim(); if (operation === 'copy') body.source_id = sourceId;
    } else { body.situation_id = selectedId; if (operation === 'update') { body.name = editName.trim(); body.card_ids = slots; } }
    running.current = true; setBusy(true); setMessage('');
    try {
      const saved = await request(`/board/layout/situations?user_id=${encodeURIComponent(targetId)}`, { method: 'PUT', body: JSON.stringify(body) });
      if (!isCurrent()) return;
      setNeedsRefresh(true); setConfirmCreate(false); setConfirmEdit(false); setConfirmDelete(false);
      try { await onSaved(saved); }
      catch { if (isCurrent()) setMessage('상황은 저장됐습니다. 최신 카드판을 확인해 주세요.'); return; }
      if (mounted.current) setNewName('');
    } catch (error) {
      if (isCurrent()) { setMessage(error.message); setNeedsRefresh(true); }
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  return <article className="situation-settings" aria-label="상황별 카드판 관리"><h3>상황별 카드판 <small>{situations.length}/{layout.max_situations || 6}</small></h3>
    <p>같은 아동의 카드 위치만 복사합니다. 다른 아동의 사진·기록·음성은 복사하지 않습니다. 기본 카드판과 각 상황의 순서는 독립적이며 핵심 잠금 위치는 공통입니다.</p>
    <fieldset disabled={disabled || busy || needsRefresh}><legend>상황 만들기·복사</legend>
      <label>기본 상황 이름<select value="" onChange={event => { setNewName(event.target.value); setConfirmCreate(false); }}>
        <option value="">이름 제안 선택</option>{(layout.situation_names || []).map(name => <option key={name} value={name}>{name}</option>)}
      </select></label>
      <label>새 상황 이름<input value={newName} maxLength={30} onChange={event => { setNewName(event.target.value); setConfirmCreate(false); }} /></label>
      <p>이름에는 사람 이름·진단 등 개인정보를 넣지 마세요.</p>
      <label>복사할 카드판<select value={sourceId} onChange={event => { setSourceId(event.target.value); setConfirmCreate(false); }}>
        <option value="default">기본 카드판</option>{situations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <ol aria-label="복사할 슬롯 미리보기">{(source?.slots || []).map(slot => <li key={slot.card_id}>슬롯 {slot.position} · {byId.get(slot.card_id) || '사용 불가 카드'}</li>)}</ol>
      <label><input type="checkbox" checked={confirmCreate} onChange={event => setConfirmCreate(event.target.checked)} />복사할 위치와 새 상황 이름을 확인했습니다</label>
      <button type="button" disabled={!newName.trim() || !confirmCreate || !source || situations.length >= (layout.max_situations || 6)} onClick={() => save(sourceId === 'default' ? 'create' : 'copy')}>확인한 카드판으로 상황 만들기</button>
    </fieldset>
    <fieldset disabled={disabled || busy || needsRefresh}><legend>저장된 상황 편집</legend>
      <label>편집할 상황<select value={selectedId} onChange={event => setSelectedId(event.target.value)}>
        <option value="">상황 선택</option>{situations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      {selected && <>
        <label>편집 상황 이름<input value={editName} maxLength={30} onChange={event => { setEditName(event.target.value); setConfirmEdit(false); }} /></label>
        <label><input type="checkbox" checked={confirmEdit} onChange={event => setConfirmEdit(event.target.checked)} />이 상황의 이름과 변경할 슬롯 순서를 확인했습니다</label>
        <BoardSlotsEditor label="상황 슬롯 편집" title="상황 카드 슬롯" layout={layout} value={slots}
          onChange={value => { setSlots(value); setConfirmEdit(false); }} onSave={() => save('update')} busy={busy}
          saveLabel="확인한 상황 저장" saveDisabled={!confirmEdit || !editName.trim()} />
        <p>상황을 삭제해도 원래 카드·사진·사용 기록은 보존합니다. 기본 카드판은 삭제하지 않습니다.</p>
        <label><input type="checkbox" checked={confirmDelete} onChange={event => setConfirmDelete(event.target.checked)} />{selected.name} 상황 구성만 삭제하는 것을 확인했습니다</label>
        <button type="button" disabled={!confirmDelete} onClick={() => save('delete')}>선택한 상황만 삭제</button>
      </>}
    </fieldset>
    {message && <p role="alert">{message}</p>}
    {needsRefresh && <button type="button" disabled={disabled || busy} onClick={onRefresh}>최신 상황·카드판 확인</button>}
  </article>;
}
