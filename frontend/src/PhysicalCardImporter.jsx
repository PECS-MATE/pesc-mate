import { useEffect, useRef, useState } from 'react';
import CardPhotoPicker from './CardPhotoPicker';
import CardImageTools from './CardImageTools';
import UiIcon from './UiIcon';
import { request } from './services/api';
import { labelKey } from './services/cardImport';
import './assets/physicalCardImporter.css';

const rectangle = () => ({ corners: [[.1, .1], [.45, .1], [.45, .5], [.1, .5]] });
const bounded = value => Math.max(0, Math.min(1, value));
function cropFile(data, index) {
  const bytes = Uint8Array.from(atob(data.split(',')[1]), value => value.charCodeAt(0));
  return new File([bytes], `card-${index + 1}.jpg`, { type: 'image/jpeg' });
}

export default function PhysicalCardImporter({ admin = false, targetId, categories = [], existingCards = [], disabled, onSaved }) {
  const [file, setFile] = useState(null), [preview, setPreview] = useState('');
  const [regions, setRegions] = useState([]), [selected, setSelected] = useState(0);
  const [rows, setRows] = useState([]), [category, setCategory] = useState('');
  const [busy, setBusy] = useState(''), [photoBusy, setPhotoBusy] = useState(false);
  const [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false), [rights, setRights] = useState(false);
  const sequence = useRef(0), mounted = useRef(true), drag = useRef(null), svg = useRef(null);
  const latest = useRef({ file, targetId, admin, disabled });
  latest.current = { file, targetId, admin, disabled };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; sequence.current += 1; };
  }, []);
  useEffect(() => {
    if (!disabled) return;
    sequence.current += 1;
    setBusy(value => value === 'save' ? value : '');
  }, [disabled]);
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function operation() {
    const run = ++sequence.current, token = localStorage.getItem('pesc-mate-token');
    const current = () => mounted.current && run === sequence.current && latest.current.file === file
      && latest.current.targetId === targetId && latest.current.admin === admin && !latest.current.disabled
      && token === localStorage.getItem('pesc-mate-token');
    current.run = run;
    return current;
  }
  function sourceBody() {
    const body = new FormData(); body.set('image', file);
    body.set('scope', admin ? 'shared' : 'private');
    if (!admin) body.set('user_id', targetId);
    return body;
  }
  function changeSource(image) {
    if (rows.some(row => row.status !== 'saved') && !window.confirm('확인 중인 카드 목록을 비우고 사진을 바꿀까요? 이미 저장된 카드는 삭제하지 않습니다.')) return;
    sequence.current += 1; setFile(image); setRegions([]); setRows([]);
    drag.current = null;
    setNotice(''); setError(''); setConfirmed(false); setRights(false);
  }
  async function detect() {
    if (!file || busy || photoBusy || disabled) return;
    if (rows.some(row => row.status !== 'saved') && !window.confirm('확인 중인 목록을 비우고 영역을 다시 찾을까요?')) return;
    const current = operation(); setBusy('detect'); setError(''); setRows([]); setConfirmed(false);
    try {
      const data = await request('/cards/scan', { method: 'POST', body: sourceBody(), timeoutMs: 30000 });
      if (!current()) return;
      setRegions(data.regions); setSelected(0);
      setNotice(data.regions.length ? `${data.regions.length}개 영역을 찾았습니다. 그림과 이름이 모두 포함됐는지 확인하세요.${data.truncated ? ' 최대 20개까지만 표시합니다.' : ''}`
        : '영역을 찾지 못했습니다. 영역 추가로 카드의 네 모서리를 지정해 주세요.');
    } catch (e) { if (current()) setError(e.message); }
    finally { if (mounted.current && current.run === sequence.current) setBusy(''); }
  }
  function moveCorner(index, point, x, y) {
    setRegions(current => current.map((region, i) => i !== index ? region : {
      corners: region.corners.map((corner, j) => j === point ? [bounded(x), bounded(y)] : corner),
    }));
    setRows([]); setConfirmed(false);
  }
  function pointerMove(event) {
    if (!drag.current || busy || disabled || rows.length) return;
    const bounds = svg.current.getBoundingClientRect();
    moveCorner(drag.current.index, drag.current.point, (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height);
  }
  const editRow = (index, fields) => {
    setRows(current => current.map((row, i) => i === index ? { ...row, ...fields } : row));
    setConfirmed(false);
  };
  async function separate() {
    if (!regions.length || busy || disabled) return;
    if (rows.some(row => row.status !== 'saved') && !window.confirm('확인 중인 목록을 비우고 다시 분리할까요?')) return;
    const current = operation(); setBusy('read'); setError(''); setConfirmed(false);
    try {
      const body = sourceBody(); body.set('regions', JSON.stringify(regions));
      const data = await request('/cards/scan', { method: 'POST', body, timeoutMs: 30000 });
      if (!current()) return;
      const next = data.cards.map((card, index) => ({ file: cropFile(card.image, index), preview: card.image,
        label: '', category, selected: true, status: 'ready', note: '' }));
      setRows(next);
      for (let index = 0; index < next.length && current(); index += 1) {
        setNotice(`${index + 1}/${next.length} 카드 이름을 읽고 있습니다.`);
        const body = new FormData(); body.set('image', next[index].file);
        if (!admin) body.set('user_id', targetId);
        try {
          const result = await request(admin ? '/admin/cards/ocr' : '/cards/ocr', { method: 'POST', body, timeoutMs: 30000 });
          if (!current()) return;
          setRows(values => values.map((row, i) => i === index ? { ...row,
            label: result.suggested_label || '',
            note: result.suggested_label ? '인식한 이름을 확인하세요.' : '글자를 찾지 못했습니다. 이름을 입력하세요.' } : row));
        } catch (e) {
          if (!current()) return;
          setRows(values => values.map((row, i) => i >= index ? { ...row, note: '이름 인식이 중단됐습니다. 직접 입력할 수 있습니다.' } : row));
          setError(e.message); break;
        }
      }
      if (current()) setNotice('분리된 그림과 이름·분류를 확인하고 저장할 카드를 선택하세요.');
    } catch (e) { if (current()) setError(e.message); }
    finally { if (mounted.current && current.run === sequence.current) setBusy(''); }
  }
  function issue(row, index) {
    if (!/^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ]{1,30}$/.test(row.label.trim())) return '이름을 한글·영문·숫자로 입력하세요.';
    if (!categories.some(item => item.name === row.category && item.active !== false)) return '분류를 선택하세요.';
    if (existingCards.some(item => item.status !== 'rejected' && labelKey(item.label) === labelKey(row.label))
      || rows.some((other, i) => i !== index && other.selected && other.status !== 'saved' && labelKey(other.label) === labelKey(row.label))) return '이미 있는 이름 또는 이번 목록의 중복 이름입니다.';
    return '';
  }
  const pending = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.selected && ['ready', 'failed'].includes(row.status));
  const invalid = pending.some(({ row, index }) => issue(row, index));
  async function save() {
    if (busy || disabled || !confirmed || (admin && !rights) || !pending.length || invalid) return;
    const current = operation(); setBusy('save'); setError(''); setNotice('');
    let attempted = false;
    try {
      for (const { row, index } of pending) {
        if (!current()) break;
        attempted = true;
        setRows(values => values.map((item, i) => i === index ? { ...item, status: 'saving' } : item));
        const body = new FormData();
        for (const key of ['label', 'category']) body.set(key, row[key].trim());
        body.set('image', row.file);
        if (!admin) { body.set('visibility', 'private'); body.set('submission_mode', 'submit'); body.set('user_id', targetId); }
        try {
          const result = await request(admin ? '/admin/cards' : '/cards/submissions', { method: 'POST', body });
          if (!current()) return;
          setRows(values => values.map((item, i) => i === index ? { ...item, status: 'saved', savedId: result.id, selected: false, note: '저장 완료' } : item));
        } catch (e) {
          if (!current()) return;
          const definite = [400, 403, 409, 413, 422, 429].includes(e.status);
          setRows(values => values.map((item, i) => i === index ? { ...item, status: definite ? 'failed' : 'uncertain',
            note: definite ? e.message : '저장 여부를 확인해야 합니다. 중복 전송하지 말고 등록 목록을 확인하세요.' } : item));
          if (!definite) break;
        }
      }
      if (current()) { setNotice('카드별 저장 결과를 확인하세요. 완료한 카드는 다시 전송하지 않습니다.'); setConfirmed(false); }
    } finally {
      if (mounted.current) {
        setRows(values => values.map(row => row.status === 'saving' ? { ...row, status: 'uncertain', note: '저장 여부를 등록 목록에서 확인하세요.' } : row));
        if (attempted && latest.current.targetId === targetId && latest.current.admin === admin) {
          try { await onSaved?.(); } catch { if (current()) setError('저장 후 목록 갱신에 실패했습니다. 새로고침해 확인하세요.'); }
        }
        if (mounted.current) setBusy('');
      }
    }
  }
  function stop() {
    sequence.current += 1; setBusy(''); setNotice('중단했습니다. 이미 분리된 카드는 확인 후 직접 입력할 수 있습니다.');
    setRows(values => values.map(row => row.status === 'saving' ? { ...row, status: 'uncertain', note: '저장 여부 확인 필요' } : row));
  }

  return <details className="physical-card-importer"><summary><UiIcon name="image" />실물 카드 한 번에 가져오기</summary>
    <div className="physical-card-body">
      <CardPhotoPicker sheet file={file} onChange={changeSource} disabled={disabled || Boolean(busy)} onBusyChange={setPhotoBusy} />
      <div className="physical-card-tools">
        <button type="button" onClick={detect} disabled={!file || disabled || Boolean(busy) || photoBusy}>카드 영역 찾기</button>
        <button type="button" disabled={!file || disabled || Boolean(busy) || rows.length > 0 || regions.length >= 20} onClick={() => { setRegions(values => [...values, rectangle()]); setSelected(regions.length); setRows([]); setConfirmed(false); }}>영역 추가</button>
        <button type="button" disabled={!regions.length || disabled || Boolean(busy) || rows.length > 0} onClick={() => { setRegions(values => values.filter((_, i) => i !== selected)); setSelected(0); setRows([]); setConfirmed(false); }}>선택 영역 삭제</button>
        {rows.length > 0 && <button type="button" disabled={disabled || Boolean(busy)} onClick={() => {
          if (window.confirm('확인 중인 목록을 비우고 영역을 수정할까요? 이미 저장한 카드는 삭제하지 않습니다.')) { setRows([]); setConfirmed(false); }
        }}>영역 다시 수정</button>}
        {busy && busy !== 'save' && <button type="button" onClick={stop}>중단</button>}
      </div>
      {preview && <div className="physical-card-sheet"><img src={preview} alt="여러 실물 카드를 펼친 촬영 사진" />
        <svg ref={svg} viewBox="0 0 1 1" preserveAspectRatio="none" onPointerMove={pointerMove}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
          {regions.map((region, index) => <g key={index} className={selected === index ? 'selected' : ''}>
            <polygon points={region.corners.map(point => point.join(',')).join(' ')} onClick={() => setSelected(index)} />
            <text x={region.corners[0][0] + .01} y={region.corners[0][1] + .04}>{index + 1}</text>
            {selected === index && region.corners.map(([x, y], point) => <g key={point}>
              <circle className="physical-corner-hit" cx={x} cy={y} r=".06"
                onPointerDown={event => { if (busy || disabled || rows.length) return; event.preventDefault(); drag.current = { index, point }; svg.current.setPointerCapture(event.pointerId); }} />
              <circle cx={x} cy={y} r=".018" pointerEvents="none" />
            </g>)}
          </g>)}
        </svg>
      </div>}
      {regions.length > 0 && <>
        <div className="physical-card-region-list" role="group" aria-label="수정할 카드 영역">{regions.map((_, index) => <button type="button" key={index} disabled={Boolean(busy) || disabled} aria-pressed={selected === index} onClick={() => setSelected(index)}>{index + 1}</button>)}</div>
        <details className="physical-card-corners"><summary>선택 영역 꼭짓점 조정</summary><p>왼쪽 위부터 시계 방향입니다. 사진의 꼭짓점을 끌거나 좌표를 수정하세요.</p>
          {regions[selected]?.corners.map(([x, y], point) => <div key={point}><span>꼭짓점 {point + 1}</span>
            <label>가로 %<input aria-label={`꼭짓점 ${point + 1} 가로 비율`} type="number" min="0" max="100" step=".1" disabled={disabled || Boolean(busy) || rows.length > 0} value={+(x * 100).toFixed(1)} onChange={e => moveCorner(selected, point, Number(e.target.value) / 100, y)} /></label>
            <label>세로 %<input aria-label={`꼭짓점 ${point + 1} 세로 비율`} type="number" min="0" max="100" step=".1" disabled={disabled || Boolean(busy) || rows.length > 0} value={+(y * 100).toFixed(1)} onChange={e => moveCorner(selected, point, x, Number(e.target.value) / 100)} /></label>
          </div>)}
        </details>
        <button type="button" className="primary" onClick={separate} disabled={disabled || Boolean(busy)}>분리하고 이름 읽기</button>
      </>}
      {rows.length > 0 && <>
        <div className="physical-card-review-toolbar">
          <strong>{rows.filter(row => row.selected && ['ready', 'failed'].includes(row.status)).length}/{rows.length}장 선택</strong>
          <button type="button" disabled={disabled || Boolean(busy)} onClick={() => {
            setRows(values => values.map(row => ['ready', 'failed'].includes(row.status) ? { ...row, selected: true } : row)); setConfirmed(false);
          }}>전체 선택</button>
          <button type="button" disabled={disabled || Boolean(busy)} onClick={() => {
            setRows(values => values.map(row => ['ready', 'failed'].includes(row.status) ? { ...row, selected: false } : row)); setConfirmed(false);
          }}>선택 해제</button>
        </div>
        <label>공통 분류<select disabled={disabled || Boolean(busy)} value={category} onChange={e => {
          setCategory(e.target.value); setConfirmed(false);
          setRows(values => values.map(row => ['ready', 'failed'].includes(row.status) ? { ...row, category: e.target.value } : row));
        }}><option value="">분류 선택</option>{categories.filter(item => item.active !== false).map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
        <ol className="physical-card-review">{rows.map((row, index) => <li key={index}>
          <img src={row.preview} alt={`${index + 1}번 분리 카드`} />
          <fieldset disabled={disabled || Boolean(busy) || ['saved', 'uncertain'].includes(row.status)}><legend>{index + 1}번 카드 · {({ saved: '저장 완료', uncertain: '저장 확인 필요', failed: '등록 실패' })[row.status] || '확인 중'}</legend>
            <label className="physical-card-check"><input type="checkbox" checked={row.selected} onChange={e => editRow(index, { selected: e.target.checked })} />등록할 카드</label>
            <label>이름<input maxLength="30" value={row.label} onChange={e => editRow(index, { label: e.target.value })} /></label>
            <CardImageTools label={row.label} file={row.file} targetId={targetId} admin={admin}
              disabled={disabled || Boolean(busy) || ['saved', 'uncertain'].includes(row.status)}
              onApply={(file, preview) => { editRow(index, { file, preview }); setRights(false); }} />
            <label>분류<select value={row.category} onChange={e => editRow(index, { category: e.target.value })}><option value="">분류 선택</option>{categories.filter(item => item.active !== false).map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
          </fieldset>
          {row.note && <p>{row.note}</p>}{row.selected && ['ready', 'failed'].includes(row.status) && issue(row, index) && <p className="error">{issue(row, index)}</p>}
        </li>)}</ol>
        <label className="physical-card-check"><input type="checkbox" checked={confirmed} disabled={disabled || Boolean(busy)} onChange={e => setConfirmed(e.target.checked)} />선택한 카드의 그림과 이름을 확인했습니다.</label>
        {admin && <label className="physical-card-check"><input type="checkbox" checked={rights} disabled={disabled || Boolean(busy)} onChange={e => setRights(e.target.checked)} />모두에게 공개할 수 있는 이미지입니다.</label>}
        <div className="physical-card-tools"><button type="button" className="primary" onClick={save} disabled={disabled || Boolean(busy) || !confirmed || (admin && !rights) || !pending.length || invalid}>{pending.length}장 {admin ? '공용 카드로' : '개인 카드로'} 저장</button>
          {rows.some(row => row.status === 'uncertain') && <button type="button" disabled={Boolean(busy) || disabled} onClick={async () => { try { await onSaved?.(); } catch (e) { setError(e.message); } }}>등록 목록 갱신</button>}
        </div>
      </>}
      {error && <p className="error" role="alert">{error}</p>}<p role="status">{notice}</p>
    </div>
  </details>;
}
