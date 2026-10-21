import { useLayoutEffect, useRef, useState } from 'react';
import { request } from './services/api';

export default function NoteHistory({ sessionId, targetId, details, authorName }) {
  const sequence = useRef(0);
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(20);
  useLayoutEffect(() => () => { sequence.current += 1; }, []);
  async function load() {
    const current = ++sequence.current;
    const token = localStorage.getItem('pesc-mate-token');
    const isCurrent = () => current === sequence.current && token
      && token === localStorage.getItem('pesc-mate-token') && navigator.onLine;
    setBusy(true); setError('');
    try {
      const result = await request(`/care/notes/${sessionId}/history?user_id=${encodeURIComponent(targetId)}`);
      if (isCurrent()) setHistory(result);
    } catch (failure) { if (isCurrent()) setError(failure.message); }
    finally { if (isCurrent()) setBusy(false); }
  }
  return <section className="note-history" aria-label="내 지원 메모 이력">
    <small>작성자: {authorName}{details?.author_id ? ` (${details.author_id})` : ''} · 내 메모만 표시
      {details?.updated_at ? ` · 수정 ${new Date(details.updated_at).toLocaleString('ko-KR')}` : ''}</small>
    {details?.deleted && <p role="status">메모 삭제 완료 · 이전 본문도 삭제되었으며 처리 시각·작성자 이력만 남습니다.</p>}
    <button type="button" disabled={busy} onClick={load}>{busy ? '이력 조회 중…' : '메모 수정·삭제 이력 보기'}</button>
    {error && <p role="alert">{error}</p>}
    {history && <><p>수정 버전 {history.revision} · {history.deleted ? '본문 삭제됨' : '현재 메모 유지'}</p>
      <ol>{[...history.history].reverse().slice(0, limit).map(item => <li key={item.revision}>
        <strong>{({ created: '작성', updated: '수정', deleted: '삭제', legacy: '기존 메모' })[item.action] || '변경'} · 버전 {item.revision}</strong>
        <small>작성자 {item.author_id} · {item.created_at ? new Date(item.created_at).toLocaleString('ko-KR') : '시각 기록 없음'}</small>
        <p>{item.content ?? '본문 삭제됨'}</p>
      </li>)}</ol>
      {history.history.length > limit && <button onClick={() => setLimit(value => value + 20)}>이전 이력 더 보기</button>}</>}
  </section>;
}
