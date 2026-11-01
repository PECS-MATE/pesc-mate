import { useEffect, useRef, useState } from 'react';
import UiIcon from './UiIcon';

export default function SentenceStrip({ cards, renderPicture, onMove, onRemove }) {
  const listRef = useRef(null);
  const pointerRef = useRef(null);
  const scrollFrameRef = useRef(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState(null);
  const [picked, setPicked] = useState(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    setPicked(null); setDrag(null); pointerRef.current = null;
    return () => {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    };
  }, [cards]);

  function track(pointer) {
    const list = listRef.current;
    if (!list || pointerRef.current !== pointer) return;
    const bounds = list.getBoundingClientRect();
    const step = pointer.x < bounds.left + 40 ? -12 : pointer.x > bounds.right - 40 ? 12 : 0;
    const previousScroll = list.scrollLeft;
    list.scrollLeft += step;
    const rows = [...list.children];
    pointer.to = rows.reduce((closest, row, candidate) => {
      const rect = row.getBoundingClientRect();
      const other = rows[closest].getBoundingClientRect();
      return Math.abs(pointer.x - (rect.left + rect.width / 2)) < Math.abs(pointer.x - (other.left + other.width / 2)) ? candidate : closest;
    }, 0);
    setDrag({ from: pointer.from, to: pointer.to, x: pointer.x, y: pointer.y });
    if (list.scrollLeft !== previousScroll && scrollFrameRef.current === null) {
      scrollFrameRef.current = requestAnimationFrame(() => { scrollFrameRef.current = null; track(pointer); });
    }
  }

  function move(from, to) {
    if (from === to) return;
    onMove(from, to);
    setNotice(`${cards[from].label} 카드를 ${to + 1}번째로 옮겼어요.`);
    requestAnimationFrame(() => {
      const button = listRef.current?.querySelectorAll('.sentence-card-move')[to];
      button?.focus({ preventScroll: true });
      button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }
  function finish(event, cancelled = false) {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    pointerRef.current = null;
    cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = null;
    setDrag(null);
    if (pointer.active) {
      suppressClick.current = !cancelled;
      if (!cancelled) move(pointer.from, pointer.to);
    }
  }
  return <>
    {cards.length > 1 && <p className="sentence-strip-guide" id="sentence-strip-help">그림카드를 옆으로 끌어 옮겨요. 카드를 누른 뒤 옮길 자리의 카드를 눌러도 돼요.</p>}
    <ol ref={listRef} className="sentence-strip" aria-label="선택한 그림카드 순서">
      {cards.map((card, index) => <li key={`${card.id}-${index}`}
        className={`${picked === index ? 'picked' : ''}${drag?.from === index ? ' dragging' : ''}${drag && drag.to === index ? ' drop-target' : ''}`}>
        <button type="button" className="sentence-card-move" data-board-action="move"
          aria-label={`${index + 1}번째 ${card.label}, 순서 옮기기`}
          aria-pressed={picked === index} aria-describedby={cards.length > 1 ? 'sentence-strip-help' : undefined}
          onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0) return;
            suppressClick.current = false;
            pointerRef.current = { id: event.pointerId, from: index, to: index, startX: event.clientX, active: false };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            const pointer = pointerRef.current;
            if (!pointer || pointer.id !== event.pointerId) return;
            if (!pointer.active && Math.abs(event.clientX - pointer.startX) < 8) return;
            pointer.active = true;
            pointer.x = event.clientX; pointer.y = event.clientY;
            setPicked(null);
            track(pointer);
          }}
          onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
          onLostPointerCapture={event => finish(event, true)}
          onClick={() => {
            if (suppressClick.current) { suppressClick.current = false; return; }
            if (picked === null) { setPicked(index); setNotice(`${card.label} 선택. 옮길 자리의 카드를 눌러 주세요.`); }
            else { move(picked, index); setPicked(null); }
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') { setPicked(null); setNotice('카드 이동을 취소했어요.'); return; }
            const to = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1
              : event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : null;
            if (to === null) return;
            event.preventDefault();
            if (to >= 0 && to < cards.length) move(index, to);
          }}>
          {renderPicture(card, 'sentence-card-picture')}<strong>{card.label}</strong>
        </button>
        <button type="button" className="sentence-card-remove" data-board-action="remove"
          aria-label={`${index + 1}번째 ${card.label} 카드 빼기`} onClick={() => onRemove(index)}><UiIcon name="close" /></button>
      </li>)}
    </ol>
    {drag && cards[drag.from] && <div className="sentence-card-ghost" aria-hidden="true" style={{ left: drag.x, top: drag.y }}>
      {renderPicture(cards[drag.from], 'sentence-card-picture')}<strong>{cards[drag.from].label}</strong>
    </div>}
    <span className="visually-hidden" role="status">{notice}</span>
  </>;
}
