import { useEffect, useRef, useState } from 'react';
import { request, requestBlob } from './services/api';
import UsbRfidReader from './UsbRfidReader';
import useReauthentication from './useReauthentication';

function CardPreview({ card, artStyle }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUrl(''); setFailed(false);
    if (!card?.custom) return;
    let active = true, objectUrl;
    requestBlob(card.thumbnail_url || card.image_url).then(blob => {
      objectUrl = URL.createObjectURL(blob);
      if (active) setUrl(objectUrl); else URL.revokeObjectURL(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [card?.id, card?.thumbnail_url, card?.image_url]);
  if (!card) return null;
  const style = url ? { backgroundImage: `url(${url})` } : card.custom ? undefined : artStyle?.(card);
  return <span role="img" aria-label={`${card.label} 그림`} className="chip-card-preview"
    style={style}>{!style ? card.custom ? failed ? '그림을 불러오지 못했습니다' : '그림을 불러오는 중' : card.label : ''}</span>;
}

export default function RfidChipRegistration({ accountId, artStyle }) {
  const [catalog, setCatalog] = useState({ cards: [], bindings: [] });
  const [uid, setUid] = useState(''), [cardId, setCardId] = useState('');
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('');
  const [armed, setArmed] = useState(true), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const epoch = useRef(0), capture = useRef(true);
  const token = localStorage.getItem('pesc-mate-token');
  const { askPassword, confirmation } = useReauthentication(`chip-registration:${accountId}:${token}`);
  const current = run => epoch.current === run && token && localStorage.getItem('pesc-mate-token') === token;
  const existing = catalog.bindings.find(row => row.uid === uid);
  const card = catalog.cards.find(row => row.id === cardId);

  async function reload(run = epoch.current) {
    setLoading(true); setError('');
    try { const data = await request('/rfid/admin/catalog'); if (current(run)) setCatalog(data); }
    catch (failure) { if (current(run)) setError(failure.message); }
    finally { if (current(run)) setLoading(false); }
  }
  useEffect(() => {
    const run = ++epoch.current;
    capture.current = true; setArmed(true); setUid(''); setCardId(''); setNotice('');
    reload(run);
    return () => { ++epoch.current; capture.current = false; };
  }, [accountId, token]);

  function selectChip(value) {
    if (!capture.current) return;
    capture.current = false; setArmed(false); setUid(value); setCardId(''); setNotice(''); setError('');
  }
  function nextChip() {
    capture.current = true; setArmed(true); setUid(''); setCardId(''); setSearch(''); setNotice(''); setError('');
  }
  async function change(targetUid, targetCardId, revision) {
    const run = epoch.current, wasArmed = capture.current;
    const previous = catalog.bindings.find(row => row.uid === targetUid);
    const selected = catalog.cards.find(row => row.id === targetCardId);
    const fields = { uid: targetUid, card_id: targetCardId, expected_revision: revision };
    setSaving(true); capture.current = false; setError(''); setNotice('');
    try {
      const password = await askPassword(targetCardId ? '공용 칩 연결 저장' : '공용 칩 연결 해제',
        `칩 ${targetUid} · ${previous?.label || (previous ? '사용 불가 카드' : '미등록')} → ${selected?.label || '연결 해제'} · 모든 사용자에게 적용됩니다.`);
      if (!password || !current(run)) return;
      const result = await request('/rfid/admin/bindings', { method: 'PUT', body: JSON.stringify({ ...fields, password }) });
      if (!current(run)) return;
      setCatalog(data => ({ ...data, bindings: result.binding
        ? [result.binding, ...data.bindings.filter(row => row.uid !== targetUid)]
        : data.bindings.filter(row => row.uid !== targetUid) }));
      if (targetUid === uid && !targetCardId) setCardId('');
      setNotice(targetCardId ? `${targetUid} → ${selected.label} 저장 완료. 칩을 떼고 ‘다음 칩 인식’을 눌러 주세요.` : `${targetUid} 공용 연결을 해제했습니다.`);
    } catch (failure) {
      if (current(run)) setError(`${failure.message} 목록을 새로고침해 실제 등록 상태를 확인한 뒤 다시 시도해 주세요.`);
    } finally { if (current(run)) { setSaving(false); capture.current = wasArmed; } }
  }
  const choices = catalog.cards.filter(row => `${row.label} ${row.category}`.includes(search.trim()));
  const registered = catalog.bindings.filter(row => `${row.uid} ${row.label || '사용 불가'}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return <section className="chip-registration" aria-label="공용 RFID 칩 등록">
    <h2>공용 RFID 칩 등록</h2>
    <p>칩을 하나씩 읽고 그림카드에 연결하세요. 등록한 공용 칩은 모든 아동에게 적용됩니다. 개인 사진 카드는 기존 아동별 RFID 설정에서 연결합니다.</p>
    <UsbRfidReader targetId={accountId} manager canMap registration eventScope="shared" onUid={selectChip} />
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="chip-registration-grid">
      <article aria-label="현재 인식한 칩"><h3>1. 칩 인식</h3>
        <p role="status">{armed ? '등록할 칩을 하나만 리더기에 대세요.' : '인식한 칩을 고정했습니다. 저장 또는 확인 후 다음 칩으로 이동하세요.'}</p>
        <p>UID: <output aria-label="인식한 칩 UID">{uid || '인식 대기'}</output></p>
        {uid && <p>{existing ? `이미 등록된 칩: ${existing.label || '사용 불가 카드'}` : '아직 등록되지 않은 칩입니다.'}</p>}
        <button type="button" disabled={saving || loading} onClick={nextChip}>다음 칩 인식</button>
      </article>
      <form onSubmit={event => { event.preventDefault(); if (uid && card && !saving && !loading) change(uid, card.id, existing?.revision ?? null); }}>
        <h3>2. 그림카드 선택 및 저장</h3>
        <label>카드 검색<input value={search} disabled={saving} onChange={event => setSearch(event.target.value)} placeholder="카드명 또는 분류" /></label>
        <label>연결할 공용 그림카드<select required value={cardId} disabled={saving || loading || !uid} onChange={event => setCardId(event.target.value)}>
          <option value="">카드를 선택해 주세요</option>
          {choices.map(row => <option key={row.id} value={row.id}>{row.label} · {row.category}</option>)}
          {card && !choices.some(row => row.id === card.id) && <option value={card.id}>{card.label} · {card.category}</option>}
        </select></label>
        <CardPreview card={card} artStyle={artStyle} />
        {uid && card && <p>저장할 연결: <code>{uid}</code> → <strong>{card.label}</strong></p>}
        <button className="primary" disabled={saving || loading || !uid || !card || existing?.card_id === cardId}>{saving ? '확인·저장 중…' : existing ? '칩 연결 변경' : '칩 등록 저장'}</button>
      </form>
    </div>
    <h3>등록된 공용 칩 {catalog.bindings.length}개</h3>
    <label>등록 목록 검색<input value={filter} onChange={event => setFilter(event.target.value)} placeholder="UID 또는 카드명" /></label>
    <button type="button" disabled={saving || loading} onClick={() => reload()}>공용 칩 목록 새로고침</button>
    {loading ? <p role="status">공용 칩 목록을 불러오는 중입니다…</p> : <ul aria-label="등록된 공용 칩">{registered.slice(0, 50).map(row => <li key={row.uid}>
      <code>{row.uid}</code> → <strong>{row.label || '사용 불가 카드'}</strong>
      <button type="button" disabled={saving} onClick={() => { capture.current = false; setArmed(false); setUid(row.uid); setCardId(row.available ? row.card_id : ''); setSearch(''); setNotice(''); }}>연결 수정</button>
      <button type="button" disabled={saving} onClick={() => change(row.uid, null, row.revision)}>연결 해제</button>
    </li>)}</ul>}
    {!loading && !registered.length && <p>검색 조건에 맞는 등록 칩이 없습니다.</p>}
    {registered.length > 50 && <p>검색 결과 중 최근 50개를 표시합니다. UID나 카드명으로 검색해 주세요.</p>}
    {confirmation}
  </section>;
}
