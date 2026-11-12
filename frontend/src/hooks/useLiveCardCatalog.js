import { useEffect, useRef, useState } from 'react';
import { request } from '../services/api';
import { observeCardCatalog } from '../services/cardCatalogEvents';

const signature = cards => JSON.stringify(cards.map(({ image_src, image_blob, image_failed, ...card }) => card));

// Refresh the library without resetting the selected sentence, folders or settings.
export default function useLiveCardCatalog({ account, loaded, offline, tab, cards, categories, hydrateImages, onUpdate }) {
  const latest = useRef(null), refreshRef = useRef(null), owned = useRef(new Set());
  const [refreshing, setRefreshing] = useState(false), [notice, setNotice] = useState('');
  const token = localStorage.getItem('pesc-mate-token');
  latest.current = { cards, categories, onUpdate };
  useEffect(() => {
    const urls = new Set(); owned.current = urls;
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [account?.id, token]);
  useEffect(() => {
    setRefreshing(false); setNotice('');
    if (account?.role !== 'user' || !loaded || offline || !token) { refreshRef.current = null; return; }
    let disposed = false, pending = false;
    const valid = () => !disposed && token === localStorage.getItem('pesc-mate-token');
    const refresh = async (manual = false) => {
      if (pending || !navigator.onLine || document.visibilityState === 'hidden') return;
      pending = true; if (manual) { setRefreshing(true); setNotice(''); }
      let created = [];
      try {
        const baseline = latest.current;
        const [rows, nextCategories] = await Promise.all([request('/cards'), request('/categories')]);
        if (!valid() || latest.current.cards !== baseline.cards) return;
        if (signature(rows) === signature(baseline.cards) && !baseline.cards.some(c => c.image_failed)
          && JSON.stringify(nextCategories) === JSON.stringify(baseline.categories)) return;
        const previous = new Map(baseline.cards.map(card => [card.id, card]));
        const next = await Promise.all(rows.map(async row => {
          const old = previous.get(row.id);
          if (old?.image_src && old.thumbnail_url === row.thumbnail_url && old.image_url === row.image_url)
            return { ...row, image_src: old.image_src, image_blob: old.image_blob };
          const [image] = await hydrateImages([row]);
          if (image.image_src) created.push(image.image_src);
          return image;
        }));
        if (!valid() || latest.current.cards !== baseline.cards) return;
        const added = next.filter(card => card.custom && !previous.has(card.id)).length;
        latest.current.onUpdate(next, nextCategories);
        if (added) setNotice(`새 카드 ${added}장이 추가됐어요.`);
        created.forEach(url => owned.current.add(url)); created = [];
      } catch { if (valid() && manual) setNotice('카드를 갱신하지 못했어요. 기존 카드는 계속 사용할 수 있어요.'); }
      finally { created.forEach(url => URL.revokeObjectURL(url)); pending = false; if (valid()) setRefreshing(false); }
    };
    refreshRef.current = refresh;
    const resume = () => { if (document.visibilityState !== 'hidden') refresh(); };
    window.addEventListener('focus', resume); window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    const stopObserving = observeCardCatalog(account.id, resume);
    const interval = window.setInterval(resume, 10000);
    return () => { disposed = true; refreshRef.current = null; window.clearInterval(interval);
      window.removeEventListener('focus', resume); window.removeEventListener('online', resume);
      stopObserving();
      document.removeEventListener('visibilitychange', resume); };
  }, [account?.id, account?.role, token, loaded, offline, hydrateImages]);
  useEffect(() => { refreshRef.current?.(); }, [tab, account?.id, loaded, offline]);
  return { refresh: () => refreshRef.current?.(true), refreshing, notice };
}
