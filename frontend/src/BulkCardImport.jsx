import { useEffect, useRef, useState } from 'react';
import { request } from './services/api';
import { createRequestId } from './services/requestId';
import { defaultImageEdits, fileIssue, filenameLabel, importIssues, MAX_IMPORT_FILES } from './services/cardImport';

const RETRYABLE = new Set([400, 409, 413, 422, 429]);
const EDITABLE = new Set(['ready', 'failed']);
const STATUS = { ready: '등록 전', saving: '저장 중', saved: '저장 완료', failed: '등록 실패',
  uncertain: '저장 여부 확인 필요', blocked: '권한 확인 필요' };

export default function BulkCardImport({ targetId, targetName, categories, existingCards = [], disabled = false, onImported }) {
  const [rows, setRows] = useState([]);
  const [category, setCategory] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const rowsRef = useRef([]);
  const running = useRef(false);
  const stop = useRef(false);
  const mounted = useRef(false);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const importedRef = useRef(onImported);
  importedRef.current = onImported;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop.current = true;
      rowsRef.current.forEach(row => { if (row.preview) URL.revokeObjectURL(row.preview); });
    };
  }, []);

  function update(change) {
    rowsRef.current = change(rowsRef.current);
    setRows(rowsRef.current);
  }
  function updateRow(id, changes) {
    update(current => current.map(row => row.id === id ? { ...row, ...changes } : row));
  }
  function chooseFiles(event) {
    const files = [...event.target.files];
    event.target.value = '';
    if (running.current || disabled || !files.length) return;
    if (files.length > MAX_IMPORT_FILES) {
      setNotice(`한 번에 ${MAX_IMPORT_FILES}장까지 선택해 주세요. 기존 선택은 유지됩니다.`);
      return;
    }
    rowsRef.current.forEach(row => { if (row.preview) URL.revokeObjectURL(row.preview); });
    update(() => files.map(file => {
      const label = filenameLabel(file.name);
      const error = fileIssue(file);
      return { id: createRequestId(), file, fileError: error,
        preview: error ? '' : URL.createObjectURL(file), label, meaning: label, category,
        status: 'ready', error: '', edits: defaultImageEdits() };
    }));
    setNotice('');
  }
  function remove(row) {
    if (running.current) return;
    if (row.preview) URL.revokeObjectURL(row.preview);
    update(current => current.filter(item => item.id !== row.id));
  }
  function applyCategory() {
    update(current => current.map(row => EDITABLE.has(row.status) ? { ...row, category } : row));
  }
  function editImage(row, changes) {
    if (running.current || disabled || !EDITABLE.has(row.status)) return;
    updateRow(row.id, { edits: { ...row.edits, ...changes }, error: '' });
  }
  const eligible = row => EDITABLE.has(row.status) && !importIssues(row, rowsRef.current, existingCards, categories).length;

  async function save() {
    if (running.current || disabled) return;
    if (!navigator.onLine) { setNotice('오프라인에서는 사진을 전송하지 않습니다. 연결 후 다시 저장해 주세요.'); return; }
    const token = localStorage.getItem('pesc-mate-token');
    if (!token) { setNotice('다시 로그인한 후 등록해 주세요.'); return; }
    const candidates = rowsRef.current.filter(eligible);
    if (!candidates.length) return;
    const current = () => mounted.current && localStorage.getItem('pesc-mate-token') === token;
    running.current = true; stop.current = false; setBusy(true); setNotice('');
    try {
      for (const row of candidates) {
        if (!current() || stop.current || disabledRef.current || !navigator.onLine) break;
        updateRow(row.id, { status: 'saving', error: '' });
        const body = new FormData();
        for (const [key, value] of Object.entries({ label: row.label.trim(), meaning: row.meaning.trim(),
          category: row.category, visibility: 'private', submission_mode: 'submit', user_id: targetId })) body.set(key, value);
        body.set('image', row.file);
        if (row.edits.crop !== 'none' || row.edits.rotation || row.edits.brightness !== 100) {
          body.set('image_edits', JSON.stringify(row.edits));
        }
        let saved;
        try {
          // One request at a time: reuse server permission, consent, quota, safety and audit checks.
          saved = await request('/cards/submissions', { method: 'POST', body });
        } catch (error) {
          if (!current()) break;
          const blocked = error.status === 401 || error.status === 403;
          const retryable = RETRYABLE.has(error.status);
          updateRow(row.id, { status: blocked ? 'blocked' : retryable ? 'failed' : 'uncertain', error: error.message });
          // A network error/5xx may arrive AFTER a write: never blindly retry that item.
          if (blocked || !retryable) break;
          continue;
        }
        if (!current()) break;
        updateRow(row.id, { status: 'saved', savedId: saved.id });
        // UI/list updates must not turn a confirmed save into a retryable upload failure.
        try { await importedRef.current?.(saved); }
        catch { if (current()) setNotice('사진은 저장됐습니다. 등록 목록을 다시 확인해 주세요.'); }
      }
    } finally {
      running.current = false;
      if (mounted.current) {
        // Never leave a stale session's row available for automatic resubmission.
        update(currentRows => currentRows.map(row => row.status === 'saving'
          ? { ...row, status: 'uncertain', error: '계정 또는 화면 상태가 바뀌었습니다. 등록 목록을 확인해 주세요.' } : row));
        setBusy(false);
      }
    }
  }

  const count = rows.filter(eligible).length;
  return <details className="bulk-card-import">
    <summary>사진 일괄 등록</summary>
    <section aria-label="사진 일괄 등록">
      <h3>{targetName}님의 카드 사진 가져오기</h3>
      <p>한 번에 최대 {MAX_IMPORT_FILES}장. 파일명의 밑줄은 공백으로 바꾸며 카드명·뜻은 저장 전에 수정할 수 있어요.</p>
      <p>개인 카드로만 저장하며 고정 카드판의 순서와 기존 카드·사진은 변경하지 않습니다. 원본 사진에는 촬영 정보가 남을 수 있어요.</p>
      <label>사진 여러 장 선택<input type="file" multiple accept="image/jpeg,image/png,image/webp"
        disabled={busy || disabled} onChange={chooseFiles} /></label>
      <div className="bulk-import-actions">
        <label>공통 카테고리<select value={category} disabled={busy || disabled} onChange={event => setCategory(event.target.value)}>
          <option value="">카테고리 선택</option>{categories.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}
        </select></label>
        <button type="button" disabled={busy || disabled || !category || !rows.length} onClick={applyCategory}>미등록 항목에 분류 적용</button>
      </div>
      {notice && <p role="alert">{notice}</p>}
      {disabled && <p role="status">현재 상태에서는 새 사진을 전송할 수 없습니다. 연결과 관리 권한을 확인해 주세요.</p>}
      {rows.length > 0 && <>
        <p role="status" aria-live="polite">전체 {rows.length}개 · 저장 완료 {rows.filter(row => row.status === 'saved').length}개 · 등록 가능 {count}개{busy ? ' · 순서대로 저장 중' : ''}</p>
        <ol className="bulk-import-list">{rows.map((row, index) => {
          const editable = EDITABLE.has(row.status) && !busy && !disabled;
          const issues = EDITABLE.has(row.status) ? importIssues(row, rows, existingCards, categories) : [];
          return <li key={row.id}>
            {row.preview && <div className="bulk-import-preview"><img src={row.preview} alt={`선택 사진 ${index + 1}`} loading="lazy" decoding="async" width="96" height="96"
              style={{ objectFit: row.edits.crop === 'square' ? 'cover' : 'contain', transform: `rotate(${row.edits.rotation}deg)`, filter: `brightness(${row.edits.brightness / 100})` }} /></div>}
            <div className="bulk-import-fields">
              <span>{index + 1}. {row.file.name} — <strong>{STATUS[row.status]}</strong></span>
              <label>카드명 {index + 1}<input value={row.label} maxLength="30" disabled={!editable} onChange={event => updateRow(row.id, { label: event.target.value, error: '' })} /></label>
              <label>카드 뜻 {index + 1}<textarea value={row.meaning} maxLength="120" rows="2" disabled={!editable} onChange={event => updateRow(row.id, { meaning: event.target.value, error: '' })} /></label>
              <label>카테고리 {index + 1}<select value={row.category} disabled={!editable} onChange={event => updateRow(row.id, { category: event.target.value, error: '' })}>
                <option value="">카테고리 선택</option>{categories.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}
              </select></label>
              <fieldset className="bulk-image-edits" disabled={!editable || Boolean(row.fileError)}>
                <legend>사진 보정 {index + 1}</legend>
                <label className="bulk-crop-option"><input type="checkbox" checked={row.edits.crop === 'square'}
                  aria-label={`${index + 1}번 사진 중앙 정사각형 자르기`}
                  onChange={event => editImage(row, { crop: event.target.checked ? 'square' : 'none' })} />중앙 정사각형 자동 자르기</label>
                <span>오른쪽 회전 {row.edits.rotation}도</span>
                <button type="button" aria-label={`${index + 1}번 사진 오른쪽 90도 회전`}
                  onClick={() => editImage(row, { rotation: (row.edits.rotation + 90) % 360 })}>오른쪽 90도 회전</button>
                <label>{index + 1}번 사진 밝기 ({row.edits.brightness}%)<input type="range" min="50" max="150" step="5"
                  aria-label={`${index + 1}번 사진 밝기`} aria-valuetext={`${row.edits.brightness}%`} value={row.edits.brightness}
                  onChange={event => editImage(row, { brightness: Number(event.target.value) })} /></label>
                <button type="button" aria-label={`${index + 1}번 사진 보정 초기화`} onClick={() => editImage(row, defaultImageEdits())}>보정 초기화</button>
                <small>원본은 그대로 보관합니다. 중앙 자르기는 글자·그림을 자를 수 있으므로 미리보기를 확인해 주세요.</small>
              </fieldset>
              {issues.map(issue => <p key={issue} className="bulk-import-issue">확인: {issue}</p>)}
              {row.error && <p className="bulk-import-issue">{row.error}</p>}
              {row.status === 'uncertain' && <p>이 항목은 다시 전송하지 않습니다. 등록 목록을 확인한 뒤 새로 선택해 주세요.</p>}
              <button type="button" disabled={busy} onClick={() => remove(row)} aria-label={`선택 사진 ${index + 1} 제외`}>선택에서 제외</button>
            </div>
          </li>;
        })}</ol>
        <div className="bulk-import-actions">
          <button type="button" className="primary" disabled={busy || disabled || !count} onClick={save}>등록 가능한 {count}개 저장</button>
          {busy && <button type="button" onClick={() => { stop.current = true; setNotice('중단 요청했습니다. 전송 중인 한 건의 결과를 확인한 뒤 멈춥니다.'); }}>다음 항목부터 중단</button>}
        </div>
        <p className="muted">저장 완료 항목은 재전송하지 않습니다. 명확한 실패 항목은 수정 후 다시 저장할 수 있어요. 통신·서버 오류로 저장 여부가 불명확하면 등록 목록부터 확인해 주세요. 선택한 사진은 이 화면을 떠나면 기기 임시 선택에서 제거됩니다.</p>
      </>}
    </section>
  </details>;
}
