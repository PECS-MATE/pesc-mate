import { useEffect, useRef, useState } from 'react';
import UiIcon from './UiIcon';

const TABS = [
  { id: 'home', name: '홈', icon: 'home' },
  { id: 'favorites', name: '즐겨찾기', icon: 'star' },
  { id: 'urgent', name: '긴급어', icon: 'shield' },
  { id: 'emotion', name: '감정', icon: 'heart' },
  { id: 'schedule', name: '시간/일정', icon: 'clock' },
];
const HOME_IDS = ['happy', 'no', 'help'];
const favoriteKey = accountId => `pesc-mate-favorites:${accountId}`;

function readFavorites(accountId, persist) {
  if (!persist) return [];
  try {
    const value = JSON.parse(localStorage.getItem(favoriteKey(accountId)) || '[]');
    return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string'))].slice(0, 500) : [];
  } catch { return []; }
}

export default function SpeakingCardLibrary({ accountId, persistFavorites, cards, categories, layout, recoveryCards,
  renderCard, renderPicture, pageSize, busy }) {
  const [tab, setTab] = useState('home');
  const [folderId, setFolderId] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [favorites, setFavorites] = useState(() => readFavorites(accountId, persistFavorites));
  const [notice, setNotice] = useState('');
  const contentRef = useRef(null);
  const folderRef = useRef(null);
  const pool = [...cards, ...recoveryCards.filter(card => !cards.some(item => item.id === card.id))];
  const byId = new Map(pool.map(card => [card.id, card]));
  const ordered = slots => (slots || []).map(slot => byId.get(slot.card_id)).filter(Boolean);
  const folders = [
    ...(layout?.slots?.length ? [{ id: 'default', name: '기본 카드판', cards: ordered(layout.slots) }] : []),
    ...(layout?.situations || []).map(item => ({ id: `situation:${item.id}`, name: item.name, cards: ordered(item.slots) })),
    ...categories.map(item => ({ id: `category:${item.id}`, name: item.name, cards: cards.filter(card => card.category === item.name) })),
    ...(recoveryCards.length ? [{ id: 'recovery', name: '다시 말하기', cards: recoveryCards }] : []),
    { id: 'all', name: '모든 카드', cards },
  ];
  const folder = folders.find(item => item.id === folderId);
  let selection = folder ? folder.cards : tab === 'home' ? HOME_IDS.map(id => byId.get(id)).filter(Boolean)
    : tab === 'favorites' ? favorites.map(id => byId.get(id)).filter(Boolean)
    : tab === 'urgent' ? cards.filter(card => card.safety_relevant)
    : tab === 'emotion' ? cards.filter(card => card.category === '감정' || ['emotion', 'physical_state', 'sensory_state', 'rejection', 'affirmation', 'uncertainty'].includes(card.semantic_group))
    : cards.filter(card => ['time', 'schedule', 'date'].includes(card.semantic_group) || /시간|일정|날짜/.test(card.category || ''));
  if (search.trim()) selection = (folder || tab !== 'home' ? selection : pool).filter(card => card.label.includes(search.trim()));
  const limit = Math.max(1, Number(pageSize) || 12);
  const count = Math.max(1, Math.ceil(selection.length / limit));
  const currentPage = Math.min(page, count - 1);
  const visible = selection.slice(currentPage * limit, (currentPage + 1) * limit);
  const showingFolders = tab === 'home' && !folder && !search.trim();

  useEffect(() => { setPage(0); }, [tab, folderId, search, limit]);
  function selectTab(id) { setTab(id); setFolderId(null); setSearch(''); setPage(0); }
  function toggleFavorite(card) {
    const next = favorites.includes(card.id) ? favorites.filter(id => id !== card.id) : [...favorites, card.id];
    setFavorites(next);
    if (persistFavorites) {
      try { localStorage.setItem(favoriteKey(accountId), JSON.stringify(next)); setNotice(''); }
      catch { setNotice('즐겨찾기를 이 기기에 저장하지 못했어요. 현재 화면에서는 사용할 수 있어요.'); }
    }
  }
  function openFolder(id) {
    folderRef.current = id; setFolderId(id); setPage(0);
    requestAnimationFrame(() => contentRef.current?.focus({ preventScroll: true }));
  }
  function closeFolder() {
    const id = folderRef.current; setFolderId(null); setSearch(''); setPage(0);
    requestAnimationFrame(() => [...document.querySelectorAll('.symbol-folder')].find(button => button.dataset.folderId === id)?.focus({ preventScroll: true }));
  }

  return <section id="card-library" className="speaking-library" tabIndex="-1" aria-label="말하기 카드">
    <nav className="speaking-tabs" aria-label="말하기 카드 분류" data-scan-group="categories">
      {TABS.map(item => <button type="button" key={item.id} aria-pressed={tab === item.id} onClick={() => selectTab(item.id)}><UiIcon name={item.icon} /><span>{item.name}</span></button>)}
    </nav>
    <div className="speaking-library-search"><input aria-label="말하기 카드 검색" placeholder="카드 검색" value={search} onChange={event => setSearch(event.target.value)} /></div>
    {folder && <div className="symbol-folder-heading"><button type="button" onClick={closeFolder}><UiIcon name="arrow-left" />폴더 목록</button><h2 ref={contentRef} tabIndex="-1">{folder.name}</h2></div>}
    {!folder && <h2 className="visually-hidden">{search.trim() ? '카드 검색 결과' : TABS.find(item => item.id === tab)?.name}</h2>}
    <div className="cards speaking-library-cards" data-scan-group="cards">{visible.map(card => <div className="speaking-library-tile" key={card.id}>
      {renderCard(card)}<button type="button" className="card-favorite" aria-pressed={favorites.includes(card.id)} aria-label={`${card.label} 즐겨찾기 ${favorites.includes(card.id) ? '해제' : '추가'}`} title={`${card.label} 즐겨찾기`} onClick={() => toggleFavorite(card)}><UiIcon name="star" />{favorites.includes(card.id) && <span className="visually-hidden">선택됨</span>}</button>
    </div>)}</div>
    {!selection.length && <p className="empty" role="status">{tab === 'favorites' && !search.trim() ? '카드의 별을 누르면 여기에 모여요.' : search.trim() ? '검색한 카드가 없어요.' : '아직 등록된 카드가 없어요.'}</p>}
    {count > 1 && <nav className="card-pagination" aria-label="말하기 카드 페이지"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>이전</button><span>{currentPage + 1} / {count}</span><button disabled={currentPage >= count - 1} onClick={() => setPage(currentPage + 1)}>다음</button></nav>}
    {showingFolders && <div className="symbol-folders" aria-label="상황별 카드 폴더">{folders.map(item => <button type="button" key={item.id} data-folder-id={item.id} className="symbol-folder" disabled={busy} onClick={() => openFolder(item.id)}>
      <span className="symbol-folder-pictures" aria-hidden="true"><UiIcon name="folder" size={36} />{item.cards.slice(0, 2).map(card => <span key={card.id}>{renderPicture(card, 'folder-card-picture')}</span>)}</span><strong>{item.name}</strong><small>{item.cards.length}장</small>
    </button>)}</div>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
