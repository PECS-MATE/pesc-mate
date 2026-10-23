import { useEffect, useId, useRef, useState } from 'react';
import { request } from './services/api';
import { fileIssue } from './services/cardImport';

function PhotoDialog({ card, targetId, trigger, disabled, onClose, onReplaced, onRefresh }) {
  const titleId = useId();
  const dialog = useRef(null);
  const mounted = useRef(false);
  const running = useRef(false);
  const allowed = useRef(!disabled);
  allowed.current = !disabled;
  const scope = useRef(`${targetId}:${card.id}`);
  scope.current = `${targetId}:${card.id}`;
  const expectedRevision = useRef(card.image_revision || 0);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [confirmedSave, setConfirmedSave] = useState(false);
  const stale = expectedRevision.current !== (card.image_revision || 0);
  useEffect(() => {
    if (disabled && running.current) {
      setNeedsRefresh(true); setError('연결 또는 관리 상태가 바뀌었습니다. 최신 등록 목록을 확인해 주세요.');
    }
  }, [disabled]);
  useEffect(() => {
    mounted.current = true;
    const current = dialog.current;
    current.showModal();
    return () => {
      mounted.current = false;
      requestAnimationFrame(() => { if (!current.isConnected && trigger?.isConnected) trigger.focus(); });
    };
  }, [trigger]);
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function save(event) {
    event.preventDefault();
    if (running.current || disabled || !file || stale || needsRefresh || confirmedSave || !navigator.onLine) return;
    const token = localStorage.getItem('pesc-mate-token');
    if (!token) { setError('다시 로그인한 후 사진을 교체해 주세요.'); return; }
    const identity = `${targetId}:${card.id}`;
    const isCurrent = () => mounted.current && scope.current === identity
      && allowed.current && navigator.onLine && localStorage.getItem('pesc-mate-token') === token;
    running.current = true; setBusy(true); setError('');
    const body = new FormData();
    body.set('user_id', targetId); body.set('expected_revision', String(expectedRevision.current)); body.set('image', file);
    let saved;
    try {
      saved = await request(`/cards/submissions/${encodeURIComponent(card.id)}/image`, { method: 'PUT', body });
    } catch (failure) {
      if (isCurrent()) {
        setError(failure.message);
        // Lost responses may follow a committed replacement. Never retry an old version blindly.
        if (![400, 413, 422, 429].includes(failure.status)) setNeedsRefresh(true);
      }
      return;
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
    if (!isCurrent()) return;
    setConfirmedSave(true);
    try { await onReplaced(saved); }
    catch { if (isCurrent()) setError('사진은 교체됐습니다. 최신 등록 목록을 다시 확인해 주세요.'); return; }
    if (isCurrent()) onClose();
  }
  return <dialog ref={dialog} className="reauthentication-dialog photo-replacement-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id={titleId}>개인 카드 사진 교체</h2>
    <p><strong>{card.label}</strong> · 카드명·뜻·분류·카드 ID·카드판 위치는 바뀌지 않습니다.</p>
    <p>현재 카드의 이전 원본과 화면용·썸네일을 새 사진으로 대체합니다. 별도 백업 사본은 기존 보존 정책을 따릅니다.</p>
    <form onSubmit={save}>
      <label>교체할 사진<input type="file" accept="image/jpeg,image/png,image/webp" required disabled={busy || disabled || needsRefresh || confirmedSave || stale}
        onChange={event => {
          const selected = event.target.files[0];
          const issue = selected ? fileIssue(selected) : '';
          setError(issue); setFile(issue ? null : selected || null);
        }} /></label>
      {preview && <img className="replacement-preview" src={preview} alt="교체할 사진 미리보기" />}
      <p>원본은 로컬 DB에 보관합니다. 촬영 정보가 남을 수 있으며 서버가 형식·크기·동의·안전성·잠금을 다시 확인합니다.</p>
      {error && <p role="alert">{error}</p>}
      {stale && <p role="alert">등록 목록의 사진 버전이 바뀌었습니다. 닫고 최신 사진을 확인해 주세요.</p>}
      {(needsRefresh || confirmedSave) && <button type="button" disabled={busy} onClick={() => { onClose(); onRefresh(); }}>닫고 최신 등록 목록 확인</button>}
      <div className="reauthentication-actions"><button type="button" disabled={busy} onClick={onClose}>닫기</button>
        <button type="submit" className="primary" disabled={busy || disabled || !file || needsRefresh || confirmedSave || stale}>사진만 교체 저장</button></div>
    </form>
  </dialog>;
}

export default function CardPhotoReplacement(props) {
  const [trigger, setTrigger] = useState(null);
  return <><button type="button" disabled={props.disabled} aria-label={`${props.card.label} 사진 교체`}
    onClick={event => setTrigger(event.currentTarget)}>사진 교체</button>
    {trigger && <PhotoDialog {...props} trigger={trigger} onClose={() => setTrigger(null)} />}</>;
}
