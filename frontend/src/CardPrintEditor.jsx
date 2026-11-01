import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { request, requestBlob } from './services/api';
import { createRequestId } from './services/requestId';
import { fileIssue, filenameLabel, importIssues, MAX_IMPORT_FILES } from './services/cardImport';
import printCss from './assets/cardPrintPage.css?inline';
import './assets/cardPrintEditor.css';

const PRINT_DOCUMENT = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>PECS Mate 카드 인쇄</title><style>@page { size: A4 portrait; margin: 10mm; } html, body { margin: 0; padding: 0; background: white; color: #344b46; font-family: Arial, sans-serif; } ${printCss}</style></head><body></body></html>`;
const STATUS = { ready: '미등록', saving: '저장 중', saved: '아이 계정 사용 가능', failed: '저장 실패', uncertain: '저장 여부 확인 필요' };

function Pages({ rows, size, labels }) {
  const columns = Math.floor(193 / (size + 3));
  const capacity = columns * Math.floor(280 / (size + 3));
  const cards = rows.flatMap(row => Array.from({ length: row.copies }, (_, copy) => ({ ...row, copy })));
  return Array.from({ length: Math.ceil(cards.length / capacity) }, (_, page) => <div className="card-print-page" key={page}
    aria-label={`A4 ${page + 1}쪽`} style={{ gridTemplateColumns: `repeat(${columns}, ${size}mm)` }}>
    {cards.slice(page * capacity, (page + 1) * capacity).map(row => <div className="card-print-cell" key={`${row.id}:${row.copy}`}
      style={{ width: `${size}mm`, height: `${size}mm` }}><img src={row.preview} alt={row.label} />{labels && <strong>{row.label}</strong>}</div>)}
  </div>);
}

export default function CardPrintEditor({ targetId, targetName, categories, existingCards, disabled, onSaved }) {
  const [rows, setRows] = useState([]);
  const [size, setSize] = useState(40);
  const [labels, setLabels] = useState(true);
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [notice, setNotice] = useState('');
  const [frameDocument, setFrameDocument] = useState(null);
  const frame = useRef(null);
  const urls = useRef(new Set());
  const mounted = useRef(false);
  const running = useRef(false);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current.clear(); };
  }, []);
  function previewFor(blob) {
    const url = URL.createObjectURL(blob);
    urls.current.add(url);
    return url;
  }
  function change(id, fields) { setRows(current => current.map(row => row.id === id ? { ...row, ...fields } : row)); }
  function chooseFiles(event) {
    const files = [...event.target.files]; event.target.value = '';
    if (running.current || !files.length) return;
    if (files.length > MAX_IMPORT_FILES || rows.length + files.length > 60) { setNotice('한 번에 20장, 편집 목록은 최대 60장까지 선택해 주세요.'); return; }
    const issue = files.map(fileIssue).find(Boolean);
    if (issue) { setNotice(issue); return; }
    const added = files.map(file => ({ id: createRequestId(), file, preview: previewFor(file),
      label: filenameLabel(file.name), meaning: filenameLabel(file.name), category: '',
      copies: 1, status: 'ready' }));
    setRows(current => [...current, ...added]);
    setNotice('사진은 아직 서버에 전송하지 않았어요. 인쇄만 하거나 아이 계정에 저장할 수 있어요.');
  }
  async function addExisting(event) {
    const id = event.target.value; event.target.value = '';
    const card = existingCards.find(item => item.id === id);
    if (!card || running.current || disabled || rows.length >= 60) return;
    running.current = true; setBusy(true); setNotice('인쇄용 이미지를 불러오고 있어요.');
    try {
      const token = localStorage.getItem('pesc-mate-token');
      const blob = await requestBlob(card.image_url);
      if (!mounted.current || disabledRef.current || token !== localStorage.getItem('pesc-mate-token')) return;
      const preview = previewFor(blob);
      setRows(current => [...current, { id: createRequestId(), existingId: card.id, originalLabel: card.label,
        label: card.label, meaning: card.meaning, category: card.category, preview, copies: 1,
        existingStatus: card.status, status: card.status === 'approved' ? 'saved' : 'ready' }]);
      setNotice('기존 카드의 인쇄 문구는 이 편집기에서만 바뀌며 아이 카드 원본은 변경하지 않아요.');
    } catch (error) { if (mounted.current) setNotice(error.message); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  function remove(row) {
    if (busy || printing) return;
    URL.revokeObjectURL(row.preview); urls.current.delete(row.preview);
    setRows(current => current.filter(item => item.id !== row.id));
  }
  function reorder(index, offset) {
    setRows(current => { const next = [...current]; const [row] = next.splice(index, 1); next.splice(index + offset, 0, row); return next; });
  }
  const candidates = rows.filter(row => ['ready', 'failed'].includes(row.status)
    && (row.file || row.existingStatus === 'draft'));
  const localCandidates = candidates.filter(row => row.file);
  const issues = localCandidates.flatMap(row => importIssues(row, localCandidates, existingCards, categories));
  async function save() {
    if (!publish || disabledRef.current || running.current || !candidates.length || issues.length) return;
    running.current = true; setBusy(true); setNotice('');
    const token = localStorage.getItem('pesc-mate-token');
    const current = () => mounted.current && !disabledRef.current && token === localStorage.getItem('pesc-mate-token');
    let savedAny = false;
    try {
      for (const row of candidates) {
        if (!current()) break;
        change(row.id, { status: 'saving', error: '' });
        try {
          let result;
          if (row.file) {
            const body = new FormData();
            for (const [key, value] of Object.entries({ label: row.label.trim(), meaning: row.meaning.trim(), category: row.category,
              visibility: 'private', submission_mode: 'submit', user_id: targetId })) body.set(key, value);
            body.set('image', row.file);
            result = await request('/cards/submissions', { method: 'POST', body });
          } else result = await request(`/cards/submissions/${encodeURIComponent(row.existingId)}/submit?user_id=${encodeURIComponent(targetId)}`, { method: 'POST' });
          savedAny = true;
          if (!current()) break;
          change(row.id, { status: 'saved', savedId: result.id });
        } catch (error) {
          if (!mounted.current) break;
          const retryable = [400, 409, 413, 422, 429].includes(error.status);
          change(row.id, { status: retryable ? 'failed' : 'uncertain', error: error.message });
          if (!retryable) break;
        }
      }
      if (current()) setNotice('저장 결과를 확인해 주세요. 사용 가능 카드는 아이 계정에서 카드를 다시 불러오면 표시돼요. 고정 카드판 위치는 바꾸지 않아요.');
    } finally {
      running.current = false;
      if (mounted.current) {
        setRows(currentRows => currentRows.map(row => row.status === 'saving'
          ? { ...row, status: 'uncertain', error: '중단됐습니다. 등록 목록에서 저장 여부를 확인해 주세요.' } : row));
        setBusy(false);
        if (savedAny && current()) {
          try { await onSaved(); } catch { if (mounted.current) setNotice('일부 카드는 저장됐지만 목록을 갱신하지 못했어요. 개인 카드 목록을 다시 불러와 주세요.'); }
        }
      }
    }
  }
  async function print() {
    if (!rows.length || busy || printing || !frameDocument) return;
    setPrinting(true); setNotice('인쇄용 그림이 준비될 때까지 기다려 주세요.');
    try {
      await frameDocument.fonts.ready;
      await Promise.all([...frameDocument.images].map(image => image.decode()));
      if (!mounted.current) return;
      frame.current.contentWindow.focus(); frame.current.contentWindow.print();
      setNotice('인쇄 창에서 A4 세로, 배율 100%, 머리글·바닥글 끄기를 확인해 주세요. PDF로 저장도 가능해요.');
    } catch { if (mounted.current) setNotice('이미지를 준비하지 못했어요. 깨진 이미지가 없는지 확인한 뒤 다시 인쇄해 주세요.'); }
    finally { if (mounted.current) setPrinting(false); }
  }
  async function refresh() {
    if (running.current || disabled || printing) return;
    running.current = true; setBusy(true);
    try {
      await onSaved();
      if (mounted.current) setNotice('등록 목록을 갱신했어요. 저장 여부가 불확실한 항목은 등록 카드 선택 목록에서 확인하세요. 이미 등록됐으면 인쇄 목록에서 미확인 항목을 빼고 등록 카드를 추가하세요.');
    } catch (error) { if (mounted.current) setNotice(error.message); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  const count = rows.reduce((sum, row) => sum + row.copies, 0);
  const locked = busy || printing;
  return <details className="card-print-editor">
    <summary>A4 그림카드 만들기·인쇄</summary>
    <h3>{targetName}님의 인쇄 카드 편집기</h3>
    <p>흰 배경·재단 테두리, 기본 4×4cm. 인쇄 문구·크기·순서·매수를 편집하고 PDF로도 저장할 수 있어요.</p>
    <p>인쇄 편집 내용은 이 화면에서만 유지돼요. 다른 사용자로 바꾸거나 화면을 나가기 전에 인쇄해 주세요.</p>
    <fieldset disabled={locked} className="card-print-options"><legend>카드 가져오기와 인쇄 설정</legend>
      <label>새 사진 선택<input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={chooseFiles} /></label>
      <label>등록 카드 추가<select defaultValue="" disabled={locked || disabled || rows.length >= 60} onChange={addExisting}><option value="">개인 카드 선택</option>
        {existingCards.filter(card => card.visibility === 'private' && !rows.some(row => row.existingId === card.id || row.savedId === card.id))
          .map(card => <option key={card.id} value={card.id}>{card.label}</option>)}
      </select></label>
      <label>카드 한 변<select value={size} onChange={event => setSize(Number(event.target.value))}><option value="40">4cm</option><option value="50">5cm</option><option value="60">6cm</option></select></label>
      <label><input type="checkbox" checked={labels} onChange={event => setLabels(event.target.checked)} />카드 이름 인쇄</label>
    </fieldset>
    <ol className="card-print-rows">{rows.map((row, index) => <li key={row.id}>
      <img src={row.preview} alt={row.label} />
      <fieldset disabled={locked}><legend>{index + 1}번째 카드 · {STATUS[row.status]}</legend>
        <label>인쇄 문구<input value={row.label} maxLength="30" onChange={event => change(row.id, { label: event.target.value })} /></label>
        {publish && row.file && ['ready', 'failed'].includes(row.status) && <><label>아이 카드 뜻<input value={row.meaning} maxLength="120" onChange={event => change(row.id, { meaning: event.target.value })} /></label>
          <label>아이 카드 분류<select value={row.category} onChange={event => change(row.id, { category: event.target.value })}><option value="">분류 선택</option>{categories.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label></>}
        <label>인쇄 매수<select value={row.copies} onChange={event => change(row.id, { copies: Number(event.target.value) })}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}장</option>)}</select></label>
        <button type="button" disabled={!index} onClick={() => reorder(index, -1)}>앞에 배치</button>
        <button type="button" disabled={index === rows.length - 1} onClick={() => reorder(index, 1)}>뒤에 배치</button>
        <button type="button" onClick={() => remove(row)}>인쇄 목록에서 빼기</button>
      </fieldset>{row.error && <p role="alert">{row.error}</p>}
    </li>)}</ol>
    <label className="card-print-publish"><input type="checkbox" checked={publish} disabled={locked || disabled} onChange={event => setPublish(event.target.checked)} />저장할 때 {targetName}님의 아이 계정에서도 사용</label>
    <p>체크하지 않으면 새 사진은 서버에 저장하지 않아요. 체크 후 저장하면 해당 아이 전용 카드로 등록해요. 체크 해제·인쇄 목록 제거는 이미 저장된 카드를 삭제하지 않아요.</p>
    <p>등록된 카드의 인쇄 문구를 바꿔도 아이 계정의 카드 이름·뜻·사진은 바뀌지 않아요. 사용 중지·반려 카드는 이 편집기에서 재활성화하지 않아요.</p>
    {publish && issues.length > 0 && <p role="alert">{[...new Set(issues)].join(' ')}</p>}
    <div className="card-print-actions"><button type="button" disabled={!publish || disabled || locked || !candidates.length || issues.length > 0} onClick={save}>아이 계정에 카드 저장</button>
      <button type="button" className="primary" disabled={!rows.length || locked || !frameDocument} onClick={print}>A4 인쇄·PDF 저장 ({count}장)</button>
      <button type="button" disabled={disabled || locked} onClick={refresh}>등록 목록 다시 불러오기</button></div>
    {notice && <p role="status">{notice}</p>}
    {rows.length > 0 && <div className="card-print-preview" aria-label="A4 인쇄 미리보기"><style>{printCss}</style><Pages rows={rows} size={size} labels={labels} /></div>}
    <iframe ref={frame} title="카드 인쇄 전용 문서" className="card-print-frame" tabIndex="-1" aria-hidden="true" srcDoc={PRINT_DOCUMENT}
      onLoad={() => setFrameDocument(frame.current.contentDocument)} />
    {frameDocument && createPortal(<Pages rows={rows} size={size} labels={labels} />, frameDocument.body)}
  </details>;
}
