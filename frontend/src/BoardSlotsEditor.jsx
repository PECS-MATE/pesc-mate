import { lockedSlotsPreserved, movedSlots } from './services/boardLocks';
import UiIcon from './UiIcon';

export default function BoardSlotsEditor({ layout, value, onChange, onSave, busy,
  label = '고정 카드 슬롯 편집', title = '고정 카드 슬롯', saveLabel = '카드판 저장', saveDisabled = false }) {
  const cards = layout.available_cards || [];
  const byId = new Map(cards.map(card => [card.id, card]));
  const toggle = id => value.includes(id) ? value.filter(cardId => cardId !== id) : [...value, id];
  const allowed = ids => ids.length <= 30 && lockedSlotsPreserved(layout, ids);
  return <article aria-label={label}><h3>{title} <small>{value.length}/30</small></h3>
    <p className="muted">선택한 카드만 번호 순서대로 표시됩니다. 잠긴 카드는 위치·사진을 유지하며, 앞선 카드를 제외해 밀리는 변경도 막습니다.</p>
    <div className="config-card-options">{cards.map(card => <button key={card.id} aria-pressed={value.includes(card.id)}
      disabled={!allowed(toggle(card.id))} onClick={() => onChange(toggle(card.id))}>{card.symbol} {card.label}</button>)}</div>
    <ol className="config-order-list">{value.map((id, index) => {
      const card = byId.get(id); const label = card?.label || id;
      return <li key={id}><span>슬롯 {index + 1} · {card?.symbol} {label}{layout.locked_card_ids?.includes(id) ? ' · 핵심 잠금' : ''}</span><div>
        <button aria-label={`${label} 앞으로`} disabled={!index || !allowed(movedSlots(value, index, -1))} onClick={() => onChange(movedSlots(value, index, -1))}><UiIcon name="arrow-up" /></button>
        <button aria-label={`${label} 뒤로`} disabled={index === value.length - 1 || !allowed(movedSlots(value, index, 1))} onClick={() => onChange(movedSlots(value, index, 1))}><UiIcon name="arrow-down" /></button>
        <button aria-label={`${label} 제외`} disabled={!allowed(toggle(id))} onClick={() => onChange(toggle(id))}><UiIcon name="close" /></button>
      </div></li>;
    })}</ol>
    {!allowed(value) && <p role="alert">편집 내용이 잠긴 핵심 카드의 위치와 다릅니다. 최신 카드판을 다시 불러와 주세요.</p>}
    <button type="button" className="primary" disabled={busy || saveDisabled || !value.length || !allowed(value)} onClick={onSave}>{busy ? '저장 중…' : saveLabel}</button>
  </article>;
}
