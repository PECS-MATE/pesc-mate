import { useState } from 'react';
import UiIcon from './UiIcon';

const PAGE_SIZE = 12;
export default function ManagedCardList({ items, total, loading, isCaregiver, focusId, reviewBusy, onEdit, onSubmitDraft }) {
  const [page, setPage] = useState(() => Math.max(0, Math.floor(items.findIndex(item => item.id === focusId) / PAGE_SIZE)));
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const active = Math.min(page, pages - 1);
  const visible = items.slice(active * PAGE_SIZE, (active + 1) * PAGE_SIZE);
  return <div className="submission-list managed-card-grid" id="managed-card-list" role="region" aria-label="등록 카드">
    <header><h3>등록 카드 <small>{items.length}개</small></h3>
      {pages > 1 && <span>{active + 1} / {pages}페이지</span>}</header>
    {loading ? <p role="status">카드를 불러오고 있어요.</p> : visible.length ? <>
      <ul>{visible.map(item => <li key={item.id} id={`managed-card-${item.id}`} tabIndex="-1">
        <span className="managed-card-info"><strong>{item.label}</strong><small>{item.category}{!isCaregiver && <> · {item.sharing_notice || (item.visibility === 'private' ? '연결 사용자만 사용' : '공개 요청')}</>}</small></span>
        <div className="submission-actions"><b className={`submission-status ${item.status}`}>{item.visibility === 'private' && item.status === 'approved' ? '사용 중' : ({ draft: '작성 중', pending: '승인 대기', approved: '공개 승인', rejected: '반려', inactive: '비활성' })[item.status] || item.status}</b>
          {['draft', 'rejected'].includes(item.status) && <button type="button" disabled={reviewBusy === item.id} onClick={() => onEdit(item)}>수정</button>}
          {item.status === 'draft' && <button type="button" className="primary" disabled={reviewBusy === item.id} onClick={() => onSubmitDraft(item)}>{item.visibility === 'private' ? '사용 시작' : '공개 승인 요청'}</button>}
        </div>
      </li>)}</ul>
      {pages > 1 && <nav className="managed-card-pagination" aria-label="등록 카드 페이지">
        <button type="button" disabled={active === 0} onClick={() => setPage(active - 1)}>이전</button>
        <span role="status">{active * PAGE_SIZE + 1}–{Math.min((active + 1) * PAGE_SIZE, items.length)} / {items.length}개</span>
        <button type="button" disabled={active === pages - 1} onClick={() => setPage(active + 1)}>다음</button>
      </nav>}
    </> : <div className="caregiver-card-empty"><UiIcon name="cards" size={32} /><strong>{total ? '검색 조건에 맞는 카드가 없어요.' : '등록된 개인 카드가 없습니다.'}</strong></div>}
  </div>;
}
