import { useState } from 'react';
import { a4Geometry, a4Preset, a4Resize, a4BackSlots, MAX_A4_PAGES } from './services/a4Layout';

export function A4Pages({ rows, layout, selected, onSelect, onDrop, locked = false, duplex = false }) {
  const geometry = a4Geometry(layout.settings);
  const byId = new Map(rows.map(row => [row.id, row]));
  const { settings, slots } = layout;
  const faces = duplex && !onSelect ? 2 : 1;
  const backs = faces === 2 ? a4BackSlots(layout) : slots;
  return Array.from({ length: slots.length / geometry.capacity * faces }, (_, face) => {
    const page = Math.floor(face / faces), back = faces === 2 && face % 2 === 1;
    return <div className="a4-sheet-group" key={face}>
    {onSelect && <p className="a4-page-number">{page + 1}쪽</p>}
    <div className="card-print-page" aria-label={`A4 ${page + 1}쪽${faces === 2 ? back ? ' 뒷면' : ' 앞면' : ''}`} style={{ width: `${geometry.width}mm`, height: `${geometry.height}mm`, padding: `${settings.margin}mm`,
      gap: `${settings.gap}mm`, justifyContent: back ? 'end' : 'start', gridTemplateColumns: `repeat(${settings.columns}, ${geometry.cellWidth}mm)`, gridTemplateRows: `repeat(${settings.rows}, ${geometry.cellHeight}mm)` }}>
      {(back ? backs : slots).slice(page * geometry.capacity, (page + 1) * geometry.capacity).map((slot, localIndex) => {
        const index = page * geometry.capacity + localIndex, row = slot && byId.get(slot.rowId);
        const content = row ? back ? <strong style={{ fontSize: `${slot.fontSize}pt` }}>{slot.label || row.label}</strong> : <><span className="a4-image-window"><img src={row.preview} alt={slot.label || row.label} draggable="false"
          style={{ objectFit: slot.fit, transform: `scale(${slot.zoom})` }} /></span>{settings.labels && <strong style={{ fontSize: `${slot.fontSize}pt` }}>{slot.label}</strong>}</> : onSelect ? <span className="a4-empty-slot">＋</span> : null;
        return onSelect ? <button type="button" key={index} disabled={locked} draggable={!!row && !locked}
          className={`card-print-cell a4-editable-cell${selected === index ? ' selected' : ''}${row ? '' : ' empty'}`}
          aria-label={`${page + 1}쪽 ${localIndex + 1}번 칸${row ? `, ${slot.label || row.label}` : ', 빈칸'}`} aria-pressed={selected === index}
          onClick={() => onSelect(index)} onDragStart={event => event.dataTransfer.setData('application/x-pecs-slot', String(index))}
          onDragOver={event => { if (!locked) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (!locked) onDrop(index, event.dataTransfer); }}>{content}</button>
          : <div key={index} className={`card-print-cell${row ? '' : ' a4-print-empty'}`}>{content}</div>;
      })}
    </div>
  </div>;
  });
}

export default function A4Workspace({ rows, layout, onChange, locked, onNotice, history, onUndo, onRedo }) {
  const [selected, setSelected] = useState(0);
  const [zoom, setZoom] = useState(60);
  const { settings, slots } = layout;
  const geometry = a4Geometry(settings);
  const selection = Math.min(selected, slots.length - 1), slot = slots[selection];
  const activeRow = slot && rows.find(row => row.id === slot.rowId);
  const pages = slots.length / geometry.capacity;
  function configure(fields) {
    try {
      let next = { ...settings, ...fields };
      if (next.size && !('columns' in fields || 'rows' in fields)) next = a4Preset(next, next.size);
      onChange(a4Resize(layout, next));
    } catch (error) { onNotice(error.message); }
  }
  function put(row, index = selection) {
    const next = [...slots];
    next[index] = { rowId: row.id, label: row.label, zoom: 1, fontSize: 12, fit: 'contain' };
    onChange({ ...layout, slots: next }); setSelected(index);
  }
  function updateSlot(fields) {
    const next = [...slots]; next[selection] = { ...slot, ...fields }; onChange({ ...layout, slots: next });
  }
  function drop(index, transfer) {
    const source = transfer.getData('application/x-pecs-slot');
    if (/^\d+$/.test(source) && Number(source) < slots.length) {
      const next = [...slots]; [next[index], next[Number(source)]] = [next[Number(source)], next[index]];
      onChange({ ...layout, slots: next }); setSelected(index); return;
    }
    const row = rows.find(item => item.id === transfer.getData('application/x-pecs-card'));
    if (row) put(row, index);
  }
  function fill() {
    const next = [...slots]; let cursor = 0;
    for (let index = 0; index < next.length && cursor < rows.length; index++) if (!next[index]) {
      const row = rows[cursor++]; next[index] = { rowId: row.id, label: row.label, zoom: 1, fontSize: 12, fit: 'contain' };
    }
    onChange({ ...layout, slots: next });
    if (cursor < rows.length) onNotice('빈칸까지만 채웠어요. 쪽을 추가하거나 나머지 카드를 직접 배치해 주세요.');
  }
  return <>
    <fieldset className="a4-layout-toolbar" disabled={locked}><legend>용지와 배치</legend>
      <label>방향<select value={settings.orientation} onChange={event => configure({ orientation: event.target.value })}><option value="portrait">A4 세로</option><option value="landscape">A4 가로</option></select></label>
      <label>양식<select value={settings.size} onChange={event => configure({ size: Number(event.target.value) })}><option value="40">4×4cm</option><option value="50">5×5cm</option><option value="60">6×6cm</option><option value="0">행·열 직접 구성</option></select></label>
      <label>열<input type="number" min="1" max="8" value={settings.columns} onChange={event => configure({ columns: Number(event.target.value), size: 0 })} /></label>
      <label>행<input type="number" min="1" max="10" value={settings.rows} onChange={event => configure({ rows: Number(event.target.value), size: 0 })} /></label>
      <label>여백 mm<input type="number" min="5" max="20" value={settings.margin} onChange={event => configure({ margin: Number(event.target.value) })} /></label>
      <label>간격 mm<input type="number" min="0" max="10" value={settings.gap} onChange={event => configure({ gap: Number(event.target.value) })} /></label>
      <label><input type="checkbox" checked={settings.labels} onChange={event => configure({ labels: event.target.checked })} />이름 인쇄</label>
      <button type="button" disabled={!history.canUndo} onClick={onUndo}>배치 실행 취소</button><button type="button" disabled={!history.canRedo} onClick={onRedo}>배치 다시 실행</button>
    </fieldset>
    <div className="a4-workspace">
      <section className="a4-library" aria-label="배치할 카드"><h4>카드 보관함</h4><p className="muted">칸을 고른 뒤 카드를 누르거나 끌어 놓으세요.</p>
        <button type="button" disabled={locked || !rows.length} onClick={fill}>빈칸 자동 채우기</button>
        <div className="a4-library-grid">{rows.map(row => <button type="button" key={row.id} disabled={locked} draggable={!locked}
          onDragStart={event => event.dataTransfer.setData('application/x-pecs-card', row.id)} onClick={() => put(row)}><img src={row.preview} alt="" /><span>{row.label || '이름 없음'}</span></button>)}</div>
        {!rows.length && <p>사진이나 등록 카드를 추가해 주세요.</p>}
      </section>
      <section className="a4-canvas" aria-label="A4 편집 영역"><div className="a4-canvas-tools">
        <label>미리보기 배율<select value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[30, 40, 50, 60, 80, 100].map(value => <option key={value} value={value}>{value}%</option>)}</select></label>
        <button type="button" disabled={locked || pages >= MAX_A4_PAGES} onClick={() => onChange({ ...layout, slots: [...slots, ...Array(geometry.capacity).fill(null)] })}>쪽 추가</button>
        <button type="button" disabled={locked || pages <= 1} onClick={() => {
          if (slots.slice(-geometry.capacity).some(Boolean) && !window.confirm('마지막 쪽에 배치한 카드를 지울까요? 보관함 원본은 유지됩니다.')) return;
          onChange({ ...layout, slots: slots.slice(0, -geometry.capacity) });
        }}>마지막 쪽 삭제</button></div>
        <div className="a4-sheet-scroll"><div style={{ zoom: zoom / 100 }}><A4Pages rows={rows} layout={layout} selected={selection} onSelect={setSelected} onDrop={drop} locked={locked} /></div></div>
      </section>
      <fieldset className="a4-properties" disabled={locked}><legend>선택한 칸 · {selection + 1}</legend>
        {activeRow ? <><label>인쇄 이름<input maxLength="30" value={slot.label} onChange={event => updateSlot({ label: event.target.value })} /></label>
          <label>글자 크기<select value={slot.fontSize} onChange={event => updateSlot({ fontSize: Number(event.target.value) })}>{[8, 10, 12, 14, 16, 20, 24].map(size => <option key={size} value={size}>{size}pt</option>)}</select></label>
          <label>그림 맞춤<select value={slot.fit} onChange={event => updateSlot({ fit: event.target.value })}><option value="contain">전체 보이기</option><option value="cover">꽉 채우기 · 일부 잘림</option></select></label>
          <label>그림 확대<input type="range" min="1" max="2" step=".1" value={slot.zoom} onChange={event => updateSlot({ zoom: Number(event.target.value) })} /></label>
          <button type="button" onClick={() => { const next = [...slots]; next[selection] = null; onChange({ ...layout, slots: next }); }}>칸 비우기</button>
          <small>인쇄 이름·그림 조정은 이 칸에만 적용됩니다.</small>
        </> : <p>왼쪽에서 카드를 선택해 넣으세요.</p>}
      </fieldset>
    </div>
  </>;
}
