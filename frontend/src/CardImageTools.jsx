import { useEffect, useRef, useState } from 'react';
import { request } from './services/api';
import './assets/cardImageTools.css';

export default function CardImageTools({ label = '', file, targetId, admin = false, disabled = false, onApply }) {
  const [opened, setOpened] = useState(false), [config, setConfig] = useState(null);
  const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null), [message, setMessage] = useState('');
  const epoch = useRef(0), mounted = useRef(false);
  const token = localStorage.getItem('pesc-mate-token');
  const scope = admin ? 'shared' : 'private';
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; epoch.current += 1; };
  }, []);
  useEffect(() => {
    epoch.current += 1; setResult(null); setBusy(false); setMessage(''); setAccepted(false); setConfig(null);
  }, [label, file, targetId, admin, disabled, token]);
  const current = run => mounted.current && run === epoch.current && !disabled
    && token === localStorage.getItem('pesc-mate-token');
  async function run(operation) {
    const seq = ++epoch.current;
    setBusy(true); setMessage('');
    try {
      let response;
      if (operation === 'status') {
        response = await request(`/card-image-tools/status?scope=${scope}${admin ? '' : `&user_id=${encodeURIComponent(targetId)}`}`);
        if (current(seq)) setConfig(response);
      } else if (operation === 'generate') {
        setAccepted(false);
        response = await request('/card-image-tools/generate', { method: 'POST', timeoutMs: 75000,
          body: JSON.stringify({ label: label.trim(), external_accepted: accepted, scope, user_id: admin ? null : targetId }) });
      } else {
        const body = new FormData(); body.set('image', file, 'card-image'); body.set('scope', scope);
        if (!admin) body.set('user_id', targetId);
        response = await request('/card-image-tools/remove-background', { method: 'POST', body, timeoutMs: 60000 });
      }
      if (operation !== 'status' && current(seq)) setResult(response);
    } catch (e) { if (current(seq)) setMessage(`${e.message}${operation === 'generate' ? ' 자동 재시도하지 않습니다.' : ''}`); }
    finally { if (current(seq)) setBusy(false); }
  }
  if (!admin && !targetId) return null;
  return <details className="card-image-tools" open={opened} onToggle={e => setOpened(e.currentTarget.open)}>
    <summary>그림 생성 · 배경 제거</summary>
    {opened && <>
      <button type="button" disabled={busy || disabled} onClick={() => run('status')}>사용 가능 여부 확인</button>
      {config && <>
        <p>{config.generation_ready ? `Gemini · ${config.model}` : '그림 생성: 서버 API 키·모델 설정 필요'}</p>
        <p>{config.background_ready ? '배경 제거: 서버 내부 처리 가능' : '배경 제거: 서버 도구·모델 준비 필요'}</p>
      </>}
      <label><input type="checkbox" checked={accepted} disabled={busy || disabled} onChange={e => setAccepted(e.target.checked)} />카드 이름을 Google로 전송하며 API 비용이 발생할 수 있음을 확인합니다. 개인정보를 입력하지 마세요.</label>
      <div>
        <button type="button" disabled={busy || disabled || !accepted || !label.trim() || !config?.generation_ready} onClick={() => run('generate')}>이름으로 그림 생성</button>
        <button type="button" disabled={busy || disabled || !file || !config?.background_ready} onClick={() => run('cutout')}>현재 사진 배경 제거</button>
      </div>
      {busy && <p role="status">이미지를 처리 중입니다. 결과 확인 전에는 원본이 유지됩니다.</p>}
      {message && <p role="alert">{message}</p>}
      {result && <div className="card-image-result">
        <img src={result.data_url} alt="적용 전 이미지 결과" />
        <p>{result.provider} · 의미와 잘린 부분을 확인하세요.</p>
        <button type="button" disabled={busy || disabled} onClick={() => {
          const [header, encoded] = result.data_url.split(',');
          const mime = header.match(/^data:([^;]+);base64$/)?.[1];
          if (!mime) { setMessage('이미지를 적용할 수 없습니다.'); return; }
          const image = new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], 'card-image.webp', { type: mime });
          onApply(image, result.data_url); setResult(null);
        }}>확인하고 적용</button>
        <button type="button" onClick={() => setResult(null)}>결과 버리기</button>
      </div>}
    </>}
  </details>;
}
