import { useEffect, useRef, useState } from 'react';
import UiIcon from './UiIcon';
import IconButton from './IconButton';

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
  renderCard, renderPicture, hasPicture = () => false, pageSize, busy }) {
  const [tab, setTab] = useState('home');
  const [folderId, setFolderId] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [favorites, setFavorites] = useState(() => readFavorites(accountId, persistFavorites));
  const [notice, setNotice] = useState('');
  const [showTools, setShowTools] = useState(false);
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
  ].filter(item => item.cards.length > 0 || item.id === 'all');
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
    <div className="speaking-library-search"><input aria-label="말하기 카드 검색" placeholder="카드 검색" value={search} onChange={event => setSearch(event.target.value)} /><IconButton icon="settings" label="카드 도구" aria-pressed={showTools} onClick={() => setShowTools(current => !current)} /></div>
    {folder && <div className="symbol-folder-heading"><IconButton icon="arrow-left" label="폴더 목록" onClick={closeFolder} /><h2 ref={contentRef} tabIndex="-1">{folder.name}</h2></div>}
    {!folder && <h2 className="visually-hidden">{search.trim() ? '카드 검색 결과' : TABS.find(item => item.id === tab)?.name}</h2>}
    <div className={`cards speaking-library-cards${showTools ? ' showing-tools' : ''}`} data-scan-group="cards">{visible.map(card => <div className="speaking-library-tile" key={card.id}>
      {renderCard(card)}{showTools && <button type="button" className="card-favorite" aria-pressed={favorites.includes(card.id)} aria-label={`${card.label} 즐겨찾기 ${favorites.includes(card.id) ? '해제' : '추가'}`} title={`${card.label} 즐겨찾기`} onClick={() => toggleFavorite(card)}><UiIcon name="star" filled={favorites.includes(card.id)} />{favorites.includes(card.id) && <span className="visually-hidden">선택됨</span>}</button>}
    </div>)}
    {showingFolders && folders.map(item => {
      const cover = item.cards.find(hasPicture);
      return <button type="button" key={`folder:${item.id}`} data-folder-id={item.id} className="symbol-folder" disabled={busy} onClick={() => openFolder(item.id)} aria-label={`${item.name} 폴더, 카드 ${item.cards.length}장`}>
        <svg className="symbol-folder-frame" viewBox="0 0 160 180" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="M16 2H54Q60 2 65 8L72 18H144Q158 18 158 32V164Q158 178 144 178H16Q2 178 2 164V16Q2 2 16 2Z" /></svg>
        <span className="symbol-folder-pictures" aria-hidden="true">{cover ? renderPicture(cover, 'folder-card-picture') : <UiIcon name="folder" size={40} className="folder-placeholder" />}</span><strong>{item.name}</strong>
      </button>;
    })}</div>
    {!selection.length && <p className="empty" role="status">{tab === 'favorites' && !search.trim() ? '카드의 별을 누르면 여기에 모여요.' : search.trim() ? '검색한 카드가 없어요.' : '아직 등록된 카드가 없어요.'}</p>}
    {count > 1 && <nav className="card-pagination" aria-label="말하기 카드 페이지"><IconButton icon="chevron-left" label="이전 페이지" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} /><span>{currentPage + 1} / {count}</span><IconButton icon="chevron-right" label="다음 페이지" disabled={currentPage >= count - 1} onClick={() => setPage(currentPage + 1)} /></nav>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
