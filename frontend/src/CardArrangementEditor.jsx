import { useEffect, useRef, useState } from 'react';
import IconButton from './IconButton';
import UiIcon from './UiIcon';
import './assets/cardArrangement.css';

export default function CardArrangementEditor({ title, cards, value, onChange, onSave, renderPicture,
  maximum = 30, minimum = 1, requiredIds = [], lockedIds = [], isAllowed = () => true, busy = false, saveDisabled = false,
  saveLabel = '카드판 저장' }) {
  const [selected, setSelected] = useState(null), [list, setList] = useState(false), [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const dragged = useRef(null);
  const byId = new Map(cards.map(card => [card.id, card]));
  const index = value.indexOf(selected), valid = isAllowed(value) && requiredIds.every(id => value.includes(id));
  useEffect(() => { if (!value.includes(selected)) setSelected(null); }, [value, selected]);
  const picture = card => renderPicture ? renderPicture(card, 'arrangement-picture') : <span className="arrangement-picture" aria-hidden="true">{card.symbol || <UiIcon name="image" size={40} />}</span>;
  function update(next, message) {
    if (busy || next.length > maximum || !requiredIds.every(id => next.includes(id)) || !isAllowed(next)) return false;
    onChange(next); setNotice(message); return true;
  }
  function reordered(from, to) {
    const next = [...value]; next.splice(to, 0, next.splice(from, 1)[0]); return next;
  }
  function move(from, to) {
    if (from < 0 || to < 0 || from >= value.length || to >= value.length) return;
    if (update(reordered(from, to), `${byId.get(value[from])?.label || '카드'} ${to + 1}번째로 이동`)) setSelected(value[from]);
  }
  const canMove = direction => index >= 0 && index + direction >= 0 && index + direction < value.length && isAllowed(reordered(index, index + direction));
  const without = value.filter(id => id !== selected);
  const canRemove = index >= 0 && value.length > minimum && !requiredIds.includes(selected) && isAllowed(without);
  return <section className="card-arrangement" aria-label={`${title} 배치 편집`}>
    <header className="arrangement-toolbar"><h3>{title} <small>{value.length}/{maximum}</small></h3><div role="group" aria-label="카드 배치 도구">
      <IconButton icon={list ? 'grid' : 'menu'} label={list ? '그림 카드로 보기' : '목록으로 보기'} aria-pressed={list} onClick={() => setList(current => !current)} />
      <IconButton icon="arrow-left" label="선택 카드 앞으로" disabled={busy || !canMove(-1)} onClick={() => move(index, index - 1)} />
      <IconButton icon="arrow-right" label="선택 카드 뒤로" disabled={busy || !canMove(1)} onClick={() => move(index, index + 1)} />
      <IconButton icon="close" label="선택 카드 제외" disabled={busy || !canRemove} onClick={() => update(without, '카드를 제외했어요.')} />
      <IconButton icon="save" label={busy ? '저장 중' : saveLabel} className="primary" aria-busy={busy} disabled={busy || saveDisabled || value.length < minimum || !valid} onClick={onSave} />
    </div></header>
    <p className="arrangement-hint">카드를 끌거나, 선택한 뒤 이동 버튼을 누르세요.</p>
    <ol className={`arrangement-cards${list ? ' arrangement-list' : ''}`} aria-label={`${title} 카드 순서`}>
      {value.map((id, position) => { const card = byId.get(id) || { id, label: '사용 불가 카드' };
        return <li key={id} onDragOver={event => { if (dragged.current !== null) event.preventDefault(); }} onDrop={event => {
          event.preventDefault(); if (dragged.current !== null) move(value.indexOf(dragged.current), position); dragged.current = null;
        }}><button type="button" className="card arrangement-card" aria-pressed={id === selected}
          aria-label={`${position + 1}번째 ${card.label}${lockedIds.includes(id) ? ' 잠금' : ''} 선택`} disabled={busy} draggable={!busy && !lockedIds.includes(id)}
          onClick={() => setSelected(id)} onDragStart={event => { dragged.current = id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); }} onDragEnd={() => { dragged.current = null; }}
          onKeyDown={event => { if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault(); move(position, position + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1));
          } }}>
          {picture(card)}<strong>{card.label}</strong><small>{position + 1}</small>{lockedIds.includes(id) && <span className="arrangement-lock" title="핵심 카드 잠금" aria-hidden="true"><UiIcon name="shield" size={18} /></span>}
        </button></li>;
      })}
    </ol>
    {!value.length && <p>추가할 카드를 골라 주세요.</p>}
    {!valid && <p role="alert">잠긴 카드 위치가 달라요. 최신 카드판을 불러와 주세요.</p>}
    <details className="arrangement-add"><summary>카드 추가</summary>
      <input aria-label="추가할 카드 검색" placeholder="카드 검색" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="arrangement-picker">{cards.filter(card => !value.includes(card.id) && card.label.includes(search.trim())).map(card => <button type="button" key={card.id}
        disabled={busy || value.length >= maximum || !isAllowed([...value, card.id])} aria-label={`${card.label} 추가`} onClick={() => update([...value, card.id], `${card.label} 추가`)}>
        {picture(card)}<strong>{card.label}</strong>
      </button>)}</div>
    </details>
    <span className="visually-hidden" role="status">{notice}</span>
  </section>;
}
