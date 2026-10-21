import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { request } from './services/api';
import { createRequestId } from './services/requestId';

export default function RecommendationsPanel({ accountId, selectedIds, cards, offline, renderCard, onCards, onOpenLibrary, historyKey }) {
  const [feed, setFeed] = useState(null);
  const [error, setError] = useState('');
  const [trackingError, setTrackingError] = useState(false);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const root = useRef(null);
  const interactionEpoch = useRef(0);
  const alive = useRef(true);
  const callback = useRef(onCards);
  callback.current = onCards;
  const selectionKey = JSON.stringify(selectedIds);
  useLayoutEffect(() => {
    alive.current = true;
    return () => { generation.current += 1; interactionEpoch.current += 1; alive.current = false; };
  }, [accountId, offline]);

  useEffect(() => {
    let active = true;
    const current = ++generation.current;
    const token = localStorage.getItem('pesc-mate-token');
    const isCurrent = () => active && current === generation.current && token
      && localStorage.getItem('pesc-mate-token') === token && navigator.onLine;
    setFeed(null); setError(''); setTrackingError(false); callback.current?.([]);
    if (offline || !navigator.onLine || !token) return () => { active = false; };
    const timer = setTimeout(async () => {
      const now = new Date();
      try {
        const result = await request('/recommendations/feed', { method: 'POST', body: JSON.stringify({
          request_id: createRequestId(), selected_card_ids: JSON.parse(selectionKey),
          hour: now.getHours(), utc_offset_minutes: now.getTimezoneOffset(),
        }) });
        if (isCurrent()) { setFeed(result); callback.current?.(result.cards); }
      } catch (failure) { if (isCurrent()) setError(failure.message); }
    }, 150);
    const refresh = () => { if (document.visibilityState === 'visible') setReload(value => value + 1); };
    const interval = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; clearTimeout(timer); clearInterval(interval);
      window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [accountId, selectionKey, offline, reload, historyKey]);

  async function expose(cardIds, snapshot = feed) {
    if (!alive.current || !snapshot?.batch_id || document.visibilityState !== 'visible' || offline || !navigator.onLine) return false;
    const current = generation.current;
    const epoch = interactionEpoch.current;
    const token = localStorage.getItem('pesc-mate-token');
    try {
      await request(`/recommendations/batches/${snapshot.batch_id}/exposures`, {
        method: 'POST', body: JSON.stringify({ card_ids: cardIds }),
      });
      return alive.current && epoch === interactionEpoch.current && navigator.onLine
        && token === localStorage.getItem('pesc-mate-token');
    } catch (failure) {
      if (current === generation.current && token === localStorage.getItem('pesc-mate-token')) {
        setTrackingError(true);
        if ([403, 409].includes(failure.status)) setReload(value => value + 1);
      }
      return false;
    }
  }
  async function selected(cardId) {
    const snapshot = feed;
    if (!await expose([cardId], snapshot)) return;
    const current = generation.current;
    const epoch = interactionEpoch.current;
    const token = localStorage.getItem('pesc-mate-token');
    try { await request(`/recommendations/batches/${snapshot.batch_id}/selections`, {
      method: 'POST', body: JSON.stringify({ card_id: cardId }),
    }); } catch { if (alive.current && epoch === interactionEpoch.current && current === generation.current
      && token === localStorage.getItem('pesc-mate-token')) setTrackingError(true); }
  }
  useEffect(() => {
    if (!feed?.batch_id || !root.current || typeof IntersectionObserver === 'undefined') return;
    const exposed = new Set();
    const observer = new IntersectionObserver(entries => {
      if (document.visibilityState !== 'visible') return;
      const ids = entries.filter(entry => entry.isIntersecting && entry.intersectionRatio >= 0.1
        && !exposed.has(entry.target.dataset.recommendationCard))
        .map(entry => entry.target.dataset.recommendationCard);
      if (!ids.length) return;
      ids.forEach(id => exposed.add(id));
      expose(ids, feed).then(saved => { if (!saved) ids.forEach(id => exposed.delete(id)); });
    }, { threshold: 0.1 });
    root.current.querySelectorAll('[data-recommendation-card]').forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [feed, offline]);

  const byId = new Map(cards.map(card => [card.id, card]));
  return <section className="recommend-panel" aria-label="추천 후보" ref={root}>
    <div className="stage-title"><div><strong>오늘의 추천 카드</strong>
      <p>선택을 돕는 후보입니다. 고정 카드판은 바뀌지 않아요.</p></div></div>
    {offline ? <p role="status">오프라인에서는 저장된 추천 대신 전체 카드에서 골라 주세요.</p>
      : error ? <div role="status">추천을 불러오지 못했습니다. 전체 카드에서 계속 선택할 수 있어요.
        <button onClick={() => setReload(value => value + 1)}>추천 다시 불러오기</button></div>
        : !feed ? <p role="status">추천 후보를 불러오는 중입니다…</p>
          : !feed.enabled ? <p>보호자·담당자가 추천을 껐습니다. 전체 카드는 그대로 사용할 수 있어요.</p>
            : !feed.cards.length ? <p>현재 설정에 맞는 추천 후보가 없습니다. 전체 카드에서 골라 주세요.</p>
              : <><small>{feed.algorithm_version} · {feed.mode === 'approval' ? '승인한 카드만 표시' : '기록 기반 후보'} · 추천은 갱신될 수 있어요.</small>
                <div className="cards recommendations">{feed.cards.map(card => <div key={card.id} data-recommendation-card={card.id}>
                  {renderCard({ ...byId.get(card.id), ...card }, () => selected(card.id))}
                </div>)}</div></>}
    {trackingError && <small role="status">일부 추천 표시·선택 여부를 저장하지 못했습니다. 카드 선택과 말하기는 계속 사용할 수 있어요.</small>}
    <button type="button" className="recommendation-library-link" onClick={onOpenLibrary}>전체 카드에서 고르기</button>
  </section>;
}
