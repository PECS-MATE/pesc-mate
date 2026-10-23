import { useEffect, useState } from 'react';

export default function SituationBoardPicker({ layout, active, disabled, offline, onSelect }) {
  const choices = [{ id: 'default', name: '기본 카드판', slots: layout?.slots || [] }, ...(layout?.situations || [])];
  const activeId = active?.id || 'default';
  const [choice, setChoice] = useState(activeId);
  const [confirmed, setConfirmed] = useState(false);
  const names = new Map((layout?.available_cards || []).map(card => [card.id, card.label]));
  const selected = choices.find(item => item.id === choice);
  const published = choices.find(item => item.id === activeId);
  const stale = active && (!published || JSON.stringify({ name: active.name, slots: active.slots })
    !== JSON.stringify({ name: published.name, slots: published.slots }));
  const fingerprint = JSON.stringify(choices);
  useEffect(() => { setConfirmed(false); }, [fingerprint, activeId]);
  return <section className="situation-board-picker" aria-label="상황 카드판 전환">
    <p role="status">현재 카드판: {active?.name || '기본 카드판'}{offline ? ' · 이 기기에 저장된 구성' : ''}</p>
    {stale && <p role="alert">현재 상황이 변경되거나 삭제됐습니다. 이 화면의 위치는 유지합니다. 아래에서 최신 카드판을 확인하고 직접 바꿔 주세요.</p>}
    <details><summary>상황 카드판 바꾸기</summary>
      <p>다른 상황으로 바꾸면 아래 카드 위치가 달라집니다. 이미 담은 문장 카드와 음성·빠른 표현·복구 표현은 그대로 유지합니다. 기록 상황은 자동으로 정하지 않습니다.</p>
      <label>사용할 상황 카드판<select value={choice} disabled={disabled} onChange={event => { setChoice(event.target.value); setConfirmed(false); }}>
        {!choices.some(item => item.id === choice) && <option value={choice}>현재 기기 보관본</option>}
        {choices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <ol aria-label="전환할 카드 위치 미리보기">{(selected?.slots || []).map(slot => <li key={slot.card_id}>슬롯 {slot.position} · {names.get(slot.card_id) || '사용 불가 카드'}</li>)}</ol>
      <label><input type="checkbox" checked={confirmed} disabled={disabled || !selected}
        onChange={event => setConfirmed(event.target.checked)} />바뀔 카드판과 위치를 확인했어요</label>
      <button type="button" disabled={disabled || !selected || !confirmed} onClick={() => {
        if (disabled || !selected || !confirmed) return;
        onSelect(selected.id === 'default' ? null : { id: selected.id, name: selected.name, slots: selected.slots.map(slot => ({ ...slot })) });
        setConfirmed(false);
      }}>확인한 상황 카드판 사용</button>
    </details>
  </section>;
}
