import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { request, requestBlob } from './services/api';
import { createRequestId } from './services/requestId';
import { fileIssue, importIssues, MAX_IMPORT_FILES } from './services/cardImport';
import printCss from './assets/cardPrintPage.css?inline';
import './assets/cardPrintEditor.css';
import A4Workspace, { A4Pages } from './A4Workspace';
import A4PrintDialog from './A4PrintDialog';
import UiIcon from './UiIcon';
import A4ProjectSave from './A4ProjectSave';
import { editorProject } from './services/a4Sharing';
import { DEFAULT_A4, validateA4Project, MAX_A4_FILE_BYTES } from './services/a4Layout';

const PRINT_DOCUMENT = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>PECS MATE 카드 인쇄</title><style>html, body { margin: 0; padding: 0; background: white; color: #344b46; font-family: Arial, sans-serif; } ${printCss}</style></head><body></body></html>`;
const STATUS = { ready: '미등록', saving: '저장 중', saved: '아이 계정 사용 가능', failed: '저장 실패', uncertain: '저장 여부 확인 필요' };

export default function CardPrintEditor({ targetId = null, targetName, categories = [], existingCards = [], disabled, onSaved,
  initialProject, initialTitle, printOnly = false }) {
  const [rows, setRows] = useState([]);
  const [history, setHistory] = useState({ past: [], present: { settings: { ...DEFAULT_A4 }, slots: Array(24).fill(null) }, future: [] });
  const layout = history.present;
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [notice, setNotice] = useState('');
  const [frameDocument, setFrameDocument] = useState(null);
  const [printDialog, setPrintDialog] = useState(false);
  const [printJob, setPrintJob] = useState(null);
  const [showCardPicker, setShowCardPicker] = useState(false);
  const photoInput = useRef(null), cameraInput = useRef(null), projectInput = useRef(null);
  const cardPicker = useRef(null), cardPickerButton = useRef(null), cardPickerId = useId();
  const printedJob = useRef(null);
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
  useEffect(() => {
    if (!initialProject) return;
    try {
      const project = editorProject(initialProject, targetId);
      const imported = project.cards.map(card => {
        const [header, encoded] = card.image.split(',');
        const type = header.slice(5, header.indexOf(';'));
        const file = new File([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))], 'card.webp', { type });
        return { ...card, file, preview: previewFor(file) };
      });
      setRows(imported); setHistory({ past: [], present: project.layout, future: [] });
      setNotice('복사본을 편집해요. 변경사항은 새 편집본으로 저장해야 보관함에 남으며 원본은 바뀌지 않아요.');
    } catch (error) { setNotice(error.message); }
  }, [initialProject, targetId]);
  useEffect(() => {
    if (!printJob || printedJob.current === printJob) return;
    printedJob.current = printJob;
    // The output portal has committed this job before the effect prepares its images.
    void print(printJob);
  }, [printJob]);
  function previewFor(blob) {
    const url = URL.createObjectURL(blob);
    urls.current.add(url);
    return url;
  }
  function change(id, fields) { setRows(current => current.map(row => row.id === id ? { ...row, ...fields } : row)); }
  function changeLayout(next) {
    setHistory(current => ({ past: [...current.past.slice(-19), current.present], present: next, future: [] }));
  }
  function undoLayout() {
    setHistory(current => !current.past.length ? current : { past: current.past.slice(0, -1), present: current.past.at(-1), future: [current.present, ...current.future] });
  }
  function redoLayout() {
    setHistory(current => !current.future.length ? current : { past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1) });
  }
  async function exportProject() {
    if (running.current || printing) return;
    running.current = true; setBusy(true);
    const token = localStorage.getItem('pesc-mate-token');
    try {
      const cards = [];
      let imageBytes = 0;
      for (const row of rows) {
        const blob = row.file || await (await fetch(row.preview)).blob();
        imageBytes += blob.size;
        if (imageBytes * 4 / 3 > MAX_A4_FILE_BYTES - 100000) throw new Error('편집본은 30MB까지 저장할 수 있어요. 보관함 사진 수나 원본 용량을 줄여 주세요.');
        const image = await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('사진을 읽지 못했어요.')); reader.readAsDataURL(blob);
        });
        cards.push({ id: row.id, label: row.label, meaning: row.meaning || '', category: row.category || '',
          status: row.status === 'saving' ? 'uncertain' : row.status, existingId: row.existingId, savedId: row.savedId, image });
      }
      const project = { format: 'pecsmate-a4', version: 1, targetId, cards, layout };
      validateA4Project(project, targetId);
      const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
      if (blob.size > MAX_A4_FILE_BYTES) throw new Error('편집본은 30MB까지 저장할 수 있어요. 보관함 사진 수나 원본 용량을 줄여 주세요.');
      if (!mounted.current || token !== localStorage.getItem('pesc-mate-token')) return;
      const url = previewFor(blob), link = document.createElement('a');
      link.href = url; link.download = 'pecsmate-a4.json'; link.click();
      window.setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 60000);
      setNotice('편집본을 다운로드했어요. 사진이 포함된 파일이므로 안전한 곳에 보관해 주세요. 서버에는 저장하지 않았어요.');
    } catch (error) { if (mounted.current) setNotice(error.message); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  async function importProject(event) {
    const file = event.target.files[0]; event.target.value = '';
    if (!file || running.current || printing) return;
    if (file.size > MAX_A4_FILE_BYTES) { setNotice('30MB 이하 편집 파일을 선택해 주세요.'); return; }
    if (rows.length && !window.confirm('현재 편집을 불러온 편집본으로 바꿀까요? 저장하지 않은 배치는 사라집니다.')) return;
    running.current = true; setBusy(true);
    const token = localStorage.getItem('pesc-mate-token');
    const importedUrls = [];
    try {
      const project = validateA4Project(JSON.parse(await file.text()), targetId);
      const imported = [];
      for (const card of project.cards) {
        const [header, encoded] = card.image.split(',');
        const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
        const type = header.slice(5, header.indexOf(';'));
        const image = new File([bytes], `card.${type.split('/')[1]}`, { type });
        const issue = fileIssue(image); if (issue) throw new Error(issue);
        const url = previewFor(image); importedUrls.push(url);
        const knownId = card.savedId || card.existingId;
        const known = knownId && existingCards.find(item => item.id === knownId && item.visibility === 'private');
        imported.push({ id: card.id, label: card.label, meaning: card.meaning, category: card.category, preview: url,
          ...(known ? { existingId: known.id, existingStatus: known.status, status: known.status === 'approved' ? 'saved' : 'uncertain' }
            : { file: image, status: knownId || ['saved', 'uncertain'].includes(card.status) ? 'uncertain' : 'ready' }) });
      }
      if (!mounted.current || token !== localStorage.getItem('pesc-mate-token')) {
        importedUrls.forEach(url => { URL.revokeObjectURL(url); urls.current.delete(url); }); return;
      }
      rows.forEach(row => { URL.revokeObjectURL(row.preview); urls.current.delete(row.preview); });
      setRows(imported); setHistory({ past: [], present: project.layout, future: [] }); setPublish(false);
      setNotice('편집본을 불러왔어요. 아이 계정 등록은 자동 실행하지 않아요. 저장 여부 확인 필요 항목은 등록 목록과 대조해 주세요.');
    } catch (error) {
      importedUrls.forEach(url => { URL.revokeObjectURL(url); urls.current.delete(url); });
      if (mounted.current) setNotice(`편집본을 불러오지 못했어요. ${error.message}`);
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  function chooseFiles(event) {
    const files = [...event.target.files]; event.target.value = '';
    if (running.current || !files.length) return;
    if (files.length > MAX_IMPORT_FILES || rows.length + files.length > 60) { setNotice('한 번에 20장, 편집 목록은 최대 60장까지 선택해 주세요.'); return; }
    const issue = files.map(fileIssue).find(Boolean);
    if (issue) { setNotice(issue); return; }
    const added = files.map(file => ({ id: createRequestId(), file, preview: previewFor(file),
      label: '', meaning: '', category: '',
      status: 'ready' }));
    setRows(current => [...current, ...added]);
    setNotice('사진은 아직 서버에 전송하지 않았어요. 인쇄만 하거나 아이 계정에 저장할 수 있어요.');
  }
  async function addExisting(event) {
    const id = event.target.value; event.target.value = '';
    setShowCardPicker(false); cardPickerButton.current?.focus();
    const card = existingCards.find(item => item.id === id);
    if (!card || running.current || disabled || rows.length >= 60) return;
    running.current = true; setBusy(true); setNotice('인쇄용 이미지를 불러오고 있어요.');
    try {
      const token = localStorage.getItem('pesc-mate-token');
      const blob = await requestBlob(card.image_url);
      if (!mounted.current || disabledRef.current || token !== localStorage.getItem('pesc-mate-token')) return;
      const preview = previewFor(blob);
      setRows(current => [...current, { id: createRequestId(), existingId: card.id, originalLabel: card.label,
        label: card.label, meaning: card.meaning, category: card.category, preview,
        existingStatus: card.status, status: card.status === 'approved' ? 'saved' : 'ready' }]);
      setNotice('기존 카드의 인쇄 문구는 이 편집기에서만 바뀌며 아이 카드 원본은 변경하지 않아요.');
    } catch (error) { if (mounted.current) setNotice(error.message); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  function remove(row) {
    if (busy || printing) return;
    URL.revokeObjectURL(row.preview); urls.current.delete(row.preview);
    setRows(current => current.filter(item => item.id !== row.id));
    // Removed sources cannot be restored by layout undo. Clear history to avoid dangling slots.
    setHistory(current => ({ past: [], future: [], present: { ...current.present,
      slots: current.present.slots.map(slot => slot?.rowId === row.id ? null : slot) } }));
  }
  const candidates = rows.filter(row => row.publishSelected !== false && ['ready', 'failed'].includes(row.status)
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
  async function print(job) {
    setNotice('인쇄용 그림이 준비될 때까지 기다려 주세요.');
    const token = localStorage.getItem('pesc-mate-token');
    try {
      await frameDocument.fonts.ready;
      await Promise.all([...frameDocument.images].map(image => image.decode()));
      if (!mounted.current || token !== localStorage.getItem('pesc-mate-token')) return;
      frame.current.contentWindow.focus(); frame.current.contentWindow.print();
      setNotice(`인쇄 창에서 A4 ${job.layout.settings.orientation === 'portrait' ? '세로' : '가로'}, 배율 100%, 여백 없음, 머리글·바닥글 끄기를 확인해 주세요.${job.duplex ? ` 양면 인쇄와 ${job.layout.settings.orientation === 'portrait' ? '긴 쪽' : '짧은 쪽'} 넘김을 선택해 주세요.` : ''} PDF 저장도 가능해요.`);
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
  const count = layout.slots.filter(slot => slot && rows.some(row => row.id === slot.rowId)).length;
  const locked = busy || printing;
  return <details className="card-print-editor" open={initialProject || printOnly ? true : undefined}>
    <summary>A4 그림카드 만들기·인쇄</summary>
    <h3>{printOnly ? '나의 카드판 편집기' : `${targetName}님의 인쇄 카드 편집기`}</h3>
    <p>카드를 배치한 뒤 프린트에서 용지를 설정하세요.</p>
    <div className="a4-import-toolbar" role="group" aria-label="카드와 편집본 도구">
      <button type="button" disabled={locked || rows.length >= 60} aria-label="사진 추가" title="사진 추가" onClick={() => photoInput.current?.click()}><UiIcon name="image" /></button>
      <button type="button" disabled={locked || rows.length >= 60} aria-label="사진 촬영" title="사진 촬영" onClick={() => cameraInput.current?.click()}><UiIcon name="camera" /></button>
      <button ref={cardPickerButton} type="button" disabled={locked || disabled || rows.length >= 60} aria-label="등록 카드 가져오기" title="등록 카드 가져오기" aria-expanded={showCardPicker} aria-controls={cardPickerId} onClick={() => {
        setShowCardPicker(value => !value);
        if (!showCardPicker) window.requestAnimationFrame(() => cardPicker.current?.focus());
      }}><UiIcon name="cards" /></button>
      <span className="a4-tool-separator" aria-hidden="true" />
      <button type="button" disabled={locked} aria-label="편집본 불러오기" title="편집본 불러오기" onClick={() => projectInput.current?.click()}><UiIcon name="folder" /></button>
      <button type="button" disabled={locked} aria-label="편집본 다운로드" title="편집본 다운로드" onClick={exportProject}><UiIcon name="download" /></button>
      <A4ProjectSave rows={rows} layout={layout} duplex={initialProject?.duplex || false} initialTitle={initialTitle} disabled={locked || disabled || !count} onNotice={setNotice} />
      <span className="a4-tool-separator" aria-hidden="true" />
      <button type="button" disabled={locked || !history.past.length} aria-label="배치 실행 취소" title="배치 실행 취소" onClick={undoLayout}><UiIcon name="undo" /></button>
      <button type="button" disabled={locked || !history.future.length} aria-label="배치 다시 실행" title="배치 다시 실행" onClick={redoLayout}><UiIcon name="undo" className="a4-redo-icon" /></button>
      <input ref={photoInput} hidden disabled={locked} type="file" aria-label="사진 파일 선택" accept="image/png,image/jpeg,image/webp" multiple onChange={chooseFiles} />
      <input ref={cameraInput} hidden disabled={locked} type="file" aria-label="촬영 사진 선택" accept="image/*" capture="environment" onChange={chooseFiles} />
      <input ref={projectInput} hidden disabled={locked} type="file" aria-label="A4 편집본 파일 선택" accept="application/json,.json" onChange={importProject} />
    </div>
    <div id={cardPickerId} hidden={!showCardPicker} className="a4-existing-picker" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setShowCardPicker(false); cardPickerButton.current?.focus(); }
    }}><label>등록 카드<select ref={cardPicker} defaultValue="" disabled={locked || disabled || rows.length >= 60} onChange={addExisting}><option value="">개인 카드 선택</option>
        {existingCards.filter(card => card.visibility === 'private' && !rows.some(row => row.existingId === card.id || row.savedId === card.id))
          .map(card => <option key={card.id} value={card.id}>{card.label}</option>)}
      </select></label>
    </div>
    <A4Workspace rows={rows} layout={layout} onChange={changeLayout} locked={locked} onNotice={setNotice}
      targetId={targetId} ocrDisabled={disabled} />
    <details className="a4-source-details"><summary>{printOnly ? '보관함 카드 정보' : '보관함 카드 정보·아이 계정 등록'}</summary><ol className="card-print-rows">{rows.map((row, index) => <li key={row.id}>
      <img src={row.preview} alt={row.label} />
      <fieldset disabled={locked}><legend>{index + 1}번째 카드 · {STATUS[row.status]}</legend>
        {publish && ['ready', 'failed'].includes(row.status) && <label><input type="checkbox" checked={row.publishSelected !== false} onChange={event => change(row.id, { publishSelected: event.target.checked })} />이 카드도 아이 계정에 등록</label>}
        <label>보관함 이름<input value={row.label} maxLength="30" onChange={event => change(row.id, { label: event.target.value })} /></label>
        {publish && row.file && ['ready', 'failed'].includes(row.status) && <><label>아이 카드 뜻<input value={row.meaning} maxLength="120" onChange={event => change(row.id, { meaning: event.target.value })} /></label>
          <label>아이 카드 분류<select value={row.category} onChange={event => change(row.id, { category: event.target.value })}><option value="">분류 선택</option>{categories.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label></>}
        <button type="button" onClick={() => remove(row)}>인쇄 목록에서 빼기</button>
      </fieldset>{row.error && <p role="alert">{row.error}</p>}
    </li>)}</ol>
    {!printOnly && <><label className="card-print-publish"><input type="checkbox" checked={publish} disabled={locked || disabled} onChange={event => setPublish(event.target.checked)} />저장할 때 {targetName}님의 아이 계정에서도 사용</label>
    <p>체크하지 않으면 새 사진은 서버에 저장하지 않아요. 체크 후 저장하면 해당 아이 전용 카드로 등록해요. 체크 해제·인쇄 목록 제거는 이미 저장된 카드를 삭제하지 않아요.</p>
    <p>등록된 카드의 인쇄 문구를 바꿔도 아이 계정의 카드 이름·뜻·사진은 바뀌지 않아요. 사용 중지·반려 카드는 이 편집기에서 재활성화하지 않아요.</p>
    {publish && issues.length > 0 && <p role="alert">{[...new Set(issues)].join(' ')}</p>}
    <div className="card-print-actions"><button type="button" disabled={!publish || disabled || locked || !candidates.length || issues.length > 0} onClick={save}>아이 계정에 카드 저장</button>
      <button type="button" disabled={disabled || locked} onClick={refresh}>등록 목록 다시 불러오기</button></div></>}
    </details>
    <div className="card-print-actions"><button type="button" className="primary" disabled={!count || locked || !frameDocument} onClick={() => setPrintDialog(true)}>프린트 ({count}장)</button></div>
    {notice && <p role="status">{notice}</p>}
    <style>{printCss}</style>
    <iframe ref={frame} title="카드 인쇄 전용 문서" className="card-print-frame" tabIndex="-1" aria-hidden="true" srcDoc={PRINT_DOCUMENT}
      onLoad={() => setFrameDocument(frame.current.contentDocument)} />
    {frameDocument && createPortal(<><style>{`@page { size: A4 ${(printJob?.layout || layout).settings.orientation}; margin: 0; }`}</style><A4Pages rows={rows} layout={printJob?.layout || layout} duplex={printJob?.duplex || false} /></>, frameDocument.body)}
    {printDialog && <A4PrintDialog rows={rows} layout={layout} initialDuplex={initialProject?.duplex || false} sharingDisabled={disabled} onClose={() => setPrintDialog(false)} onPrint={job => {
      if (busy || printing || !frameDocument) return;
      setPrinting(true); setPrintJob(job); setPrintDialog(false);
    }} />}
  </details>;
}
