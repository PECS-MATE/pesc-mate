import { useCallback, useLayoutEffect, useRef, useState } from 'react';

// Keep large card images out of the DOM until the user approaches them.
export default function useCardScroll(cards, pageSize = 12, resetKey = '') {
  const listRef = useRef(null);
  const batchSize = Math.max(1, Math.floor(Number(pageSize) || 12));
  const key = JSON.stringify([resetKey, batchSize, cards.map(card => card.id)]);
  const [windowState, setWindowState] = useState({ key, count: batchSize });
  const count = windowState.key === key ? windowState.count : batchSize;
  const total = cards.length;
  const revealMore = useCallback(() => {
    const next = Math.min(total, count + batchSize);
    if (next <= count) return;
    setWindowState(current => current.key === key && current.count >= next
      ? current : { key, count: next });
  }, [key, count, batchSize, total]);

  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [key]);

  useLayoutEffect(() => {
    const node = listRef.current;
    if (!node || count >= total) return;
    // A wide viewport or text-only cards may need more than one batch to scroll.
    const fillViewport = () => {
      if (node.clientHeight > 0 && node.scrollHeight <= node.clientHeight + 1) revealMore();
    };
    fillViewport();
    const observer = new ResizeObserver(fillViewport);
    observer.observe(node);
    return () => observer.disconnect();
  }, [key, count, total, revealMore]);

  function onScroll(event) {
    const node = event.currentTarget;
    if (node.scrollHeight - node.scrollTop - node.clientHeight <= 96) revealMore();
  }

  return { listRef, onScroll, visibleCards: cards.slice(0, count) };
}
