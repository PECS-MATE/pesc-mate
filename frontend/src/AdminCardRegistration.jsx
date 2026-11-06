import { useEffect, useId, useRef, useState } from 'react';
import UiIcon from './UiIcon';
import CardPhotoPicker from './CardPhotoPicker';
import CardOcrAssist from './CardOcrAssist';
import CardImageTools from './CardImageTools';
import { request, requestBlob } from './services/api';
import { textCardImage } from './services/textCardImage';
import './assets/adminCardRegistration.css';

export default function AdminCardRegistration({ categories, disabled, onCreated }) {
  const heading = useId();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [mode, setMode] = useState('text');
  const [label, setLabel] = useState('');
  const [meaning, setMeaning] = useState('');
  const [category, setCategory] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let disposed = false;
    let url;
    setPreview('');
    const image = mode === 'photo' ? Promise.resolve(file) : label.trim()
      ? textCardImage(label.trim()) : Promise.resolve(null);
    image.then(blob => {
      if (disposed || !blob) return;
      url = URL.createObjectURL(blob); setPreview(url);
    }).catch(() => { if (!disposed) setError('미리보기를 만들지 못했습니다. 다시 입력해 주세요.'); });
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [label, mode, file]);

  async function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (busy || disabled || photoBusy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'photo' && (!file || !rights)) throw new Error('사진과 공용 사용 권한을 확인해 주세요.');
      const data = new FormData();
      data.set('label', label.trim()); data.set('meaning', meaning.trim()); data.set('category', category);
      const image = mode === 'text' ? await textCardImage(label.trim()) : file;
      data.set('image', image, mode === 'text' ? 'text-card.png' : file.name);
      const saved = await request('/admin/cards', { method: 'POST', body: data });
      if (!mounted.current) return;
      try {
        const blob = await requestBlob(saved.thumbnail_url || saved.image_url);
        if (!mounted.current) return;
        saved.image_src = URL.createObjectURL(blob);
      } catch { /* Registration succeeded; list can reload the image later. */ }
      if (!mounted.current) return;
      onCreated(saved);
      setNotice(`‘${saved.label}’ 카드를 공용 카드로 등록했습니다.`);
      setLabel(''); setMeaning(''); setFile(null); setRights(false);
      form.reset();
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <section className="admin-card-registration" aria-labelledby={heading}>
    <header><h2 id={heading}>공용 카드 등록</h2><p>저장하면 모든 사용자가 사용할 수 있습니다. RFID 연결은 나중에 해도 됩니다.</p></header>
    <form onSubmit={save}>
      <fieldset disabled={busy || disabled}>
        <legend className="visually-hidden">공용 카드 정보</legend>
        <div className="admin-card-modes" role="group" aria-label="카드 종류">
          <button type="button" aria-pressed={mode === 'text'} onClick={() => { setMode('text'); setError(''); }}><UiIcon name="cards" />글자 카드</button>
          <button type="button" aria-pressed={mode === 'photo'} onClick={() => { setMode('photo'); setError(''); }}><UiIcon name="image" />사진 카드</button>
        </div>
        <div className="admin-card-fields">
          <div className="admin-card-preview" aria-label="카드 미리보기">
            {preview ? <img src={preview} alt={`${label || '등록할 카드'} 미리보기`} /> : <span>{mode === 'text' ? '카드명을 입력하세요' : '사진을 선택하세요'}</span>}
          </div>
          <div className="admin-card-inputs">
            <label>카드명<input required maxLength={30} value={label} onChange={e => setLabel(e.target.value)} placeholder="예: 언제" /></label>
            <label>뜻<textarea required maxLength={120} rows={2} value={meaning} onChange={e => setMeaning(e.target.value)} placeholder="예: 시간을 묻는 표현" /></label>
            <label>분류<select required value={category} onChange={e => setCategory(e.target.value)}><option value="" disabled>분류 선택</option>
              {categories.filter(item => item.active !== false).map(item => <option key={item.id} value={item.name}>{item.name}</option>)}
            </select></label>
            {mode === 'photo' && <>
              <CardPhotoPicker file={file} disabled={busy || disabled} onBusyChange={setPhotoBusy}
                onChange={image => { setFile(image); setRights(false); setError(''); }} />
              <CardOcrAssist file={file} admin disabled={busy || disabled || photoBusy} onApply={value => {
                setLabel(value); if (!meaning.trim()) setMeaning(value);
              }} />
              <small>JPG·PNG·WebP · 5MB 이하 · 가로·세로 128~4096px</small>
              <CardImageTools label={label} file={file} admin disabled={busy || disabled || photoBusy}
                onApply={image => { setFile(image); setRights(false); }} />
              <label className="admin-card-rights"><input type="checkbox" required checked={rights} onChange={e => setRights(e.target.checked)} />모두에게 공개할 수 있는 사진입니다.</label>
            </>}
          </div>
        </div>
        <footer><button className="primary" type="submit" disabled={photoBusy || (mode === 'photo' && !file) || !categories.some(item => item.active !== false)}><UiIcon name="plus" />{busy ? '등록 중…' : '저장하고 바로 사용'}</button></footer>
      </fieldset>
      {error && <p role="alert" className="error">{error}</p>}
      <p role="status">{notice}</p>
    </form>
  </section>;
}
