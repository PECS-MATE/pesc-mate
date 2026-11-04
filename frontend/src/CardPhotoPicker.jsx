import { useEffect, useRef, useState } from 'react';
import UiIcon from './UiIcon';
import { prepareCameraPhoto } from './services/cameraPhoto';
import { fileIssue } from './services/cardImport';
import './assets/cardPhotoPicker.css';

export default function CardPhotoPicker({ file, disabled, onChange, onBusyChange, sheet = false }) {
  const camera = useRef(null), gallery = useRef(null);
  const sequence = useRef(0);
  const latest = useRef({ disabled, onChange, onBusyChange });
  latest.current = { disabled, onChange, onBusyChange };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => () => { sequence.current += 1; latest.current.onBusyChange?.(false); }, []);

  async function choose(event, capture) {
    const selected = event.target.files?.[0]; event.target.value = '';
    if (!selected || disabled || busy) return;
    const run = ++sequence.current;
    setBusy(true); setError(''); onBusyChange?.(true);
    try {
      const image = capture ? await prepareCameraPhoto(selected) : selected;
      const issue = fileIssue(image);
      if (issue) throw new Error(issue);
      if (run === sequence.current && !latest.current.disabled) latest.current.onChange(image);
    } catch (e) { if (run === sequence.current) setError(e.message); }
    finally { if (run === sequence.current) { setBusy(false); latest.current.onBusyChange?.(false); } }
  }

  return <section className="card-photo-picker" aria-label="실물 카드 사진">
    <div className="card-photo-picker-actions">
      <button type="button" disabled={disabled || busy} onClick={() => camera.current?.click()}><UiIcon name="image" />카드 촬영</button>
      <button type="button" disabled={disabled || busy} onClick={() => gallery.current?.click()}><UiIcon name="cards" />사진 선택</button>
      {file && <button type="button" disabled={disabled || busy} aria-label="선택 사진 삭제" onClick={() => onChange(null)}><UiIcon name="close" /></button>}
    </div>
    <input ref={camera} hidden type="file" accept="image/*" capture="environment" aria-label="카메라로 실물 카드 촬영" disabled={disabled || busy} onChange={event => choose(event, true)} />
    <input ref={gallery} hidden type="file" accept="image/jpeg,image/png,image/webp" aria-label="기존 카드 사진 선택" disabled={disabled || busy} onChange={event => choose(event, false)} />
    {preview && <img className="card-photo-picker-preview" src={preview} alt="등록할 실물 카드 사진" />}
    <small>{sheet ? '카드를 겹치지 않게 간격을 두고 펼쳐 촬영하세요. 최대 20장까지 분리합니다.' : '한 장의 카드와 이름이 크게 보이도록 촬영하세요. 촬영본은 등록용 크기로 줄입니다.'}</small>
    <p role="status">{busy ? '사진 준비 중…' : ''}</p>
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
