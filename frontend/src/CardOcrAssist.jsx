import { useEffect, useId, useRef, useState } from 'react';
import { request } from './services/api';
import { fileIssue } from './services/cardImport';
import './assets/cardOcr.css';

export default function CardOcrAssist({ file, targetId, disabled = false, onApply }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null);
  const [candidate, setCandidate] = useState('');
  const suggestionsId = useId();
  const sequence = useRef(0);
  const latest = useRef({ file, targetId, disabled });
  latest.current = { file, targetId, disabled };
  useEffect(() => {
    sequence.current += 1; setBusy(false); setResult(null); setCandidate(''); setMessage('');
    return () => { sequence.current += 1; };
  }, [file, targetId, disabled]);

  async function recognize() {
    const issue = fileIssue(file);
    if (issue) { setMessage(issue); return; }
    const run = ++sequence.current;
    setBusy(true); setMessage(''); setResult(null);
    const body = new FormData();
    body.append('image', file, 'card-image'); body.append('user_id', targetId);
    const current = () => run === sequence.current && latest.current.file === file
      && latest.current.targetId === targetId && !latest.current.disabled;
    try {
      const data = await request('/cards/ocr', { method: 'POST', body, timeoutMs: 30000 });
      if (!current()) return;
      setResult(data); setCandidate(data.suggested_label || '');
      setMessage(data.suggested_label ? '이름을 확인한 뒤 적용해 주세요.' : '글자를 찾지 못했어요. 이름을 직접 입력해 주세요.');
    } catch (error) {
      if (current()) setMessage(error.name === 'TimeoutError' ? '시간이 초과됐어요. 잠시 후 다시 시도해 주세요.' : error.message);
    } finally { if (current()) setBusy(false); }
  }

  if (!targetId || !file) return null;
  return <section className="card-ocr-assist" aria-label="사진 글자 인식">
    <button type="button" disabled={disabled || busy} onClick={recognize}>{busy ? '글자 읽는 중…' : '사진 글자 읽기'}</button>
    <small>사진을 현재 서버로 전송해 읽습니다. 카드 등록이나 외부 서비스 전송은 하지 않습니다.</small>
    <p role="status">{message}</p>
    {result?.suggested_label && <><label>인식한 이름<input maxLength="30" value={candidate} list={suggestionsId}
      disabled={disabled || busy} onChange={event => setCandidate(event.target.value)} /></label>
      <datalist id={suggestionsId}>{result.candidates.map(value => <option key={value} value={value} />)}</datalist>
      <button type="button" disabled={disabled || busy || !candidate.trim()} onClick={() => {
        onApply(candidate.trim()); setResult(null); setMessage('이름을 적용했어요. 저장 전 내용을 확인해 주세요.');
      }}>이 이름 사용</button></>}
  </section>;
}
