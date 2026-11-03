import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { request } from './services/api';
import { createRequestId } from './services/requestId';
import { A4_TOPICS, A4_STATUS, projectRows } from './services/a4Sharing';
import CardPrintEditor from './CardPrintEditor';
import { A4Pages } from './A4Workspace';
import UiIcon from './UiIcon';
import './assets/cardPrintEditor.css';
import printCss from './assets/cardPrintPage.css?inline';
import './assets/a4Sharing.css';

function ProjectDialog({ initial, canReview, disabled, onClose, onChanged, onEdit }) {
  const [item, setItem] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [reason, setReason] = useState(''), [notice, setNotice] = useState('');
  const modal = useRef(null), mounted = useRef(false), working = useRef(false), copyId = useRef(createRequestId());
  const trigger = useRef(document.activeElement), titleId = useId();
  useEffect(() => {
    mounted.current = true; modal.current.showModal();
    return () => { mounted.current = false; if (trigger.current?.isConnected) trigger.current.focus(); };
  }, []);
  async function action(kind, reviewAction) {
    if (working.current || disabled) return;
    if (kind === 'withdraw' && !window.confirm('공유를 중단할까요? 이미 복사·인쇄한 사본은 회수할 수 없습니다.')) return;
    if (kind === 'delete' && !window.confirm(`‘${item.title}’ 편집본을 보관함에서 삭제할까요? 되돌릴 수 없으며 이미 복사·인쇄한 다른 사본은 삭제되지 않습니다.`)) return;
    working.current = true; setBusy(true); setError('');
    const token = localStorage.getItem('pesc-mate-token');
    try {
      const body = kind === 'copy' ? { request_id: copyId.current } : kind === 'report' ? { reason }
        : kind === 'review' ? { action: reviewAction, expected_version: item.version, reason } : { expected_version: item.version };
      const result = await request(`/a4/projects/${item.id}${kind === 'delete' ? '' : `/${kind}`}`, { method: kind === 'delete' ? 'DELETE' : 'POST', body: JSON.stringify(body), timeoutMs: 45000 });
      if (!mounted.current || token !== localStorage.getItem('pesc-mate-token')) return;
      onChanged();
      if (kind === 'delete') onClose();
      else if (kind === 'copy') onEdit(result);
      else if (kind === 'report') setNotice('신고를 접수했어요. 운영 담당자가 확인합니다.');
      else { setItem(result); setReason(''); setNotice(kind === 'withdraw' ? '공유를 중단했어요.' : '검토 결과를 저장했어요.'); }
    } catch (failure) { if (mounted.current && token === localStorage.getItem('pesc-mate-token')) setError(`${failure.message} 응답이 끊겼다면 내 보관함이나 검토 목록을 다시 확인해 주세요.`); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }
  return createPortal(<dialog ref={modal} className="a4-sharing-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><div><h2 id={titleId}>{item.title}</h2><small>{item.topic} · {item.pages}쪽 · {item.card_count}장 · {A4_STATUS[item.status]}</small></div>
      <button type="button" disabled={busy} aria-label="카드판 닫기" onClick={onClose}><UiIcon name="close" /></button></header>
    {item.description && <p className="a4-sharing-description">{item.description}</p>}
    <div className="a4-sharing-preview"><div className="a4-sharing-pages"><A4Pages rows={projectRows(item.project)} layout={item.project.layout} duplex={item.project.duplex} /></div></div>
    <p>복사 후 카드·문구·배치를 바꿔 인쇄할 수 있어요. 아이 계정에는 자동 등록하지 않습니다.</p>
    {item.source_title && <p>복사한 원본: {item.source_title}</p>}
    {item.review_reason && <p>검토 사유: {item.review_reason}</p>}
    {!!item.reports?.length && <section><h3>접수된 신고</h3><ul>{item.reports.map((report, index) => <li key={index}>{report.reason}</li>)}</ul></section>}
    {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="a4-sharing-actions">
      {item.mine && <button type="button" className="primary" disabled={busy || disabled} onClick={() => onEdit(item)}>편집·인쇄</button>}
      {!item.mine && !canReview && item.status === 'approved' && <button type="button" className="primary" disabled={busy || disabled} onClick={() => action('copy')}>내 보관함에 복사하고 편집</button>}
      {item.mine && ['pending', 'approved'].includes(item.status) && <button type="button" disabled={busy || disabled} onClick={() => action('withdraw')}>공유 중단</button>}
      {item.mine && ['private', 'withdrawn', 'rejected'].includes(item.status) && <button type="button" disabled={busy || disabled} onClick={() => action('delete')}>보관함에서 삭제</button>}
      <button type="button" disabled={busy} onClick={onClose}>닫기</button>
    </div>
    {canReview && ['pending', 'approved'].includes(item.status) && <fieldset disabled={busy || disabled} className="a4-sharing-review"><legend>공유 검토</legend>
      <p>모든 쪽의 인물·문구·이미지 권한과 개인정보를 확인한 후 처리해 주세요.</p>
      <label>검토 사유<input maxLength="300" value={reason} onChange={event => setReason(event.target.value)} /></label><div className="a4-sharing-actions">
        {item.status === 'pending' && <><button type="button" disabled={item.mine} onClick={() => action('review', 'approve')}>승인</button><button type="button" disabled={reason.trim().length < 3} onClick={() => action('review', 'reject')}>반려</button></>}
        {item.status === 'approved' && <><button type="button" disabled={reason.trim().length < 3} onClick={() => action('review', 'withdraw')}>공개 중단</button><button type="button" disabled={item.mine || reason.trim().length < 3} onClick={() => action('review', 'dismiss')}>신고 검토 완료·공개 유지</button></>}
      </div></fieldset>}
    {!item.mine && !canReview && item.status === 'approved' && <details><summary>이 카드판 신고</summary><form onSubmit={event => { event.preventDefault(); action('report'); }}>
      <label>신고 사유<textarea required minLength="3" maxLength="300" value={reason} onChange={event => setReason(event.target.value)} disabled={busy || disabled} /></label>
      <button disabled={busy || disabled || reason.trim().length < 3}>신고 접수</button></form></details>}
  </dialog>, document.body);
}

export default function A4SharingGallery({ accountId, canReview = false, disabled = false }) {
  const [scope, setScope] = useState(canReview ? 'review' : 'discover'), [topic, setTopic] = useState(''), [query, setQuery] = useState('');
  const [search, setSearch] = useState(''), [offset, setOffset] = useState(0), [revision, setRevision] = useState(0);
  const [items, setItems] = useState([]), [more, setMore] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [detail, setDetail] = useState(null), [editing, setEditing] = useState(null);
  const generation = useRef(0), detailGeneration = useRef(0), live = useRef(true), editorHeading = useRef(null);
  useEffect(() => { live.current = true; return () => { live.current = false; detailGeneration.current += 1; }; }, []);
  useEffect(() => {
    const run = ++generation.current, token = localStorage.getItem('pesc-mate-token');
    setItems([]); setError(''); setMore(false);
    if (disabled) { setBusy(false); return; }
    setBusy(true);
    request(`/a4/projects?${new URLSearchParams({ scope, topic, q: search, offset })}`).then(result => {
      if (run === generation.current && live.current && token === localStorage.getItem('pesc-mate-token')) { setItems(result.items); setMore(result.has_more); }
    }).catch(failure => { if (run === generation.current && live.current) setError(failure.message); })
      .finally(() => { if (run === generation.current && live.current) setBusy(false); });
    return () => { generation.current += 1; detailGeneration.current += 1; };
  }, [accountId, scope, topic, search, offset, revision, disabled]);
  useEffect(() => { if (editing) editorHeading.current?.focus(); }, [editing]);
  async function open(item) {
    const run = ++detailGeneration.current, token = localStorage.getItem('pesc-mate-token'); setError('');
    try {
      const result = await request(`/a4/projects/${item.id}`);
      if (live.current && run === detailGeneration.current && token === localStorage.getItem('pesc-mate-token')) setDetail(result);
    } catch (failure) { if (live.current && run === detailGeneration.current) setError(failure.message); }
  }
  function edit(item) { setDetail(null); setEditing(item); }
  return <section className="a4-sharing-gallery" aria-label={canReview ? '공유 카드판 검토' : '보호자 카드판 공유'}>
    <style>{printCss}</style>
    {editing ? <><header><h2 ref={editorHeading} tabIndex="-1">{editing.title}</h2><button type="button" onClick={() => {
      if (window.confirm('편집기를 닫을까요? 새 편집본으로 저장하지 않은 변경사항은 사라집니다.')) { setEditing(null); setRevision(value => value + 1); }
    }}>보관함으로 돌아가기</button></header>
      <CardPrintEditor key={editing.id} printOnly initialProject={editing.project} initialTitle={`${editing.title}`}
        targetId={null} disabled={disabled} onSaved={async () => {}} />
    </> : <><header className="a4-sharing-heading"><h2>{canReview ? '공유 카드판 검토' : '의사소통판'}</h2><p>{canReview ? '공유 요청과 신고를 확인하세요.' : '다양한 상황에 맞는 그림 카드판을 만나 보세요.'}</p></header>
      <div className="a4-sharing-toolbar"><div className="a4-sharing-actions">{!canReview && <button type="button" className="primary" disabled={disabled} onClick={() => edit({ id: 'new', title: '새 그림 카드판', project: null })}>새 카드판 만들기</button>}
      <button type="button" disabled={disabled || busy} aria-label="공유 카드판 새로고침" onClick={() => setRevision(value => value + 1)}><UiIcon name="refresh" /></button></div>
      <div className="a4-sharing-tabs" role="group" aria-label="카드판 목록 선택">{[['discover', '둘러보기'], ...(!canReview ? [['mine', '내 보관함']] : [['review', '승인·신고 검토']])].map(([value, label]) => <button type="button" key={value} aria-pressed={scope === value} onClick={() => { setScope(value); setOffset(0); }}>{label}</button>)}</div>
      </div>
      <form className="a4-sharing-search" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setOffset(0); }}>
        <label>카드판 검색<input maxLength="60" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <label>주제<select value={topic} onChange={event => { setTopic(event.target.value); setOffset(0); }}><option value="">모든 주제</option>{A4_TOPICS.map(value => <option key={value}>{value}</option>)}</select></label><button disabled={disabled}>검색</button>
      </form>
      {disabled ? <p role="status">온라인 연결 후 공유 카드판을 이용할 수 있어요.</p> : busy ? <p role="status">카드판을 불러오는 중…</p> : !items.length ? <p>아직 카드판이 없어요.{!canReview && ' A4 편집기의 저장·공유 버튼으로 새 편집본을 남겨 보세요.'}</p> : <div className="a4-sharing-grid">{items.map(item => <button type="button" key={item.id} className="a4-sharing-tile" onClick={() => open(item)}>
        <span className="a4-sharing-tile-preview"><img src={item.preview} alt="" loading="lazy" /></span>
        <span className="a4-sharing-tile-info"><strong>{item.title}</strong><span className="a4-sharing-tile-topic">#{item.topic}</span>
          <span className="a4-sharing-tile-meta"><small>{item.pages}쪽 · {item.card_count}장</small>{/^\d{4}-\d{2}-\d{2}/.test(item.created_at || '') && <time dateTime={item.created_at.slice(0, 10)}>{item.created_at.slice(0, 10).replaceAll('-', '.')} 등록</time>}</span>
          {scope !== 'discover' && <small className="a4-sharing-tile-status">{A4_STATUS[item.status]}</small>}
        </span>
      </button>)}</div>}
      <div className="a4-sharing-actions"><button type="button" disabled={disabled || busy || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 12))}>이전</button><span>{offset / 12 + 1}쪽</span><button type="button" disabled={disabled || busy || !more} onClick={() => setOffset(value => value + 12)}>다음</button></div>
    </>}
    {error && <p role="alert" className="error">{error}</p>}
    {detail && <ProjectDialog key={detail.id} initial={detail} canReview={canReview} disabled={disabled} onClose={() => setDetail(null)} onChanged={() => setRevision(value => value + 1)} onEdit={edit} />}
  </section>;
}
