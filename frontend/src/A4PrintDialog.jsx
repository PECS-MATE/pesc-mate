import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { A4Pages } from './A4Workspace';
import { a4Geometry, a4Preset, a4Resize } from './services/a4Layout';
import A4ProjectSave from './A4ProjectSave';
import IconButton from './IconButton';

export default function A4PrintDialog({ rows, layout: initialLayout, initialDuplex = false, sharingDisabled = false, onClose, onPrint }) {
  const [layout, setLayout] = useState(initialLayout);
  const [duplex, setDuplex] = useState(initialDuplex);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(60);
  const panel = useRef(null), title = useId();
  const { settings } = layout;
  const geometry = a4Geometry(settings);
  const pages = layout.slots.length / geometry.capacity;
  useEffect(() => {
    const previousFocus = document.activeElement, background = document.querySelector('.app');
    const previousInert = background?.inert, previousOverflow = document.body.style.overflow;
    if (background) background.inert = true;
    document.body.style.overflow = 'hidden'; panel.current?.focus();
    return () => {
      if (background) background.inert = previousInert;
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  function configure(fields) {
    try {
      let next = { ...settings, ...fields };
      if (next.size && !('columns' in fields || 'rows' in fields)) next = a4Preset(next, next.size);
      setLayout(a4Resize(layout, next)); setError('');
    } catch (issue) { setError(issue.message); }
  }
  function keydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const controls = [...panel.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus(); }
  }
  return createPortal(<div className="a4-print-overlay"><section ref={panel} className="a4-print-dialog" role="dialog" aria-modal="true" aria-labelledby={title} tabIndex="-1" onKeyDown={keydown}>
    <div className="a4-print-preview-panel"><label>미리보기 배율<select value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[30, 40, 50, 60, 80, 100].map(value => <option key={value} value={value}>{value}%</option>)}</select></label>
      <div className="a4-print-preview-scroll" tabIndex="0" aria-label="인쇄 미리보기"><div style={{ zoom: zoom / 100 }}><A4Pages rows={rows} layout={layout} duplex={duplex} /></div></div>
    </div>
    <div className="a4-print-settings"><h2 id={title}>프린트 설정</h2>
      <fieldset><legend>레이아웃 · A4</legend>{[['portrait', '세로'], ['landscape', '가로']].map(([value, label]) => <label key={value}><input type="radio" name={`${title}-orientation`} checked={settings.orientation === value} onChange={() => configure({ orientation: value })} />{label}</label>)}</fieldset>
      <label className="a4-print-count">카드 크기<select value={settings.size} onChange={event => configure({ size: Number(event.target.value) })}><option value="40">4×4cm</option><option value="50">5×5cm</option><option value="60">6×6cm</option><option value="0">행·열 직접 구성</option></select></label>
      <label className="a4-print-count">가로 카드 수<input type="number" min="1" max="8" value={settings.columns} onChange={event => configure({ columns: Number(event.target.value), size: 0 })} /></label>
      <label className="a4-print-count">세로 카드 수<input type="number" min="1" max="10" value={settings.rows} onChange={event => configure({ rows: Number(event.target.value), size: 0 })} /></label>
      <fieldset><legend>카드 이름</legend>{[[true, '표시'], [false, '숨기기']].map(([value, label]) => <label key={label}><input type="radio" name={`${title}-labels`} checked={settings.labels === value} onChange={() => configure({ labels: value })} />{label}</label>)}</fieldset>
      <fieldset><legend>양면 구성</legend>{[[false, '단면 카드'], [true, '양면 카드']].map(([value, label]) => <label key={label}><input type="radio" name={`${title}-duplex`} checked={duplex === value} onChange={() => setDuplex(value)} />{label}</label>)}</fieldset>
      <details className="a4-print-advanced"><summary>여백·간격</summary>
        <label className="a4-print-count">용지 여백 mm<input type="number" min="5" max="20" value={settings.margin} onChange={event => configure({ margin: Number(event.target.value) })} /></label>
        <label className="a4-print-count">카드 간격 mm<input type="number" min="0" max="10" value={settings.gap} onChange={event => configure({ gap: Number(event.target.value) })} /></label>
      </details>
      {duplex && <p className="a4-print-note">앞면은 그림, 뒷면은 카드 이름입니다. 인쇄창에서 양면 인쇄와 {settings.orientation === 'portrait' ? '긴 쪽' : '짧은 쪽'} 넘김을 선택하세요. 프린터의 양면 지원과 정렬은 별도 확인이 필요합니다.</p>}
      <p className="a4-print-note">카드 크기 {geometry.cellWidth.toFixed(1)} × {geometry.cellHeight.toFixed(1)}mm · 출력 {pages * (duplex ? 2 : 1)}면</p>
      <p className="a4-print-note">여기서 바꾼 설정은 이번 출력에만 적용됩니다.</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="a4-print-dialog-actions"><A4ProjectSave rows={rows} layout={layout} duplex={duplex} disabled={sharingDisabled || !!error} onNotice={setNotice} />
        <IconButton icon="close" label="취소" onClick={onClose} /><IconButton icon="print" label="프린트" className="a4-print-confirm" disabled={!!error} onClick={() => onPrint({ layout, duplex })} /></div>
    </div>
  </section></div>, document.body);
}
