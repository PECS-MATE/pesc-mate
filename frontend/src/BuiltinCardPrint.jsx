import { useEffect, useRef, useState } from 'react';
import { request } from './services/api';
import UiIcon from './UiIcon';

export default function BuiltinCardPrint({ accountId, disabled = false }) {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const generation = useRef(0), working = useRef(false), downloads = useRef(new Map());
  useEffect(() => {
    ++generation.current; working.current = false; setBusy(false); setNotice(''); setError('');
    return () => {
      ++generation.current;
      for (const [url, timer] of downloads.current) { clearTimeout(timer); URL.revokeObjectURL(url); }
      downloads.current.clear();
    };
  }, [accountId, disabled]);
  async function download() {
    if (working.current || disabled) return;
    const run = ++generation.current, token = localStorage.getItem('pesc-mate-token');
    const current = () => generation.current === run && token === localStorage.getItem('pesc-mate-token');
    working.current = true; setBusy(true); setError(''); setNotice('인쇄 파일을 준비하고 있어요.');
    try {
      const cards = await request('/cards/builtin');
      if (!current()) return;
      const { builtinCardPrint } = await import('./services/builtinCardPrint');
      const result = await builtinCardPrint(cards, { current, onProgress: (done, total) => {
        if (current()) setNotice(`인쇄 파일 준비 중 · ${done}/${total}`);
      } });
      if (!current()) return;
      const url = URL.createObjectURL(result.blob), link = document.createElement('a');
      link.href = url; link.download = 'PECS-MATE-all-cards-A4.html';
      document.body.append(link); link.click(); link.remove();
      const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.current.delete(url); }, 60000);
      downloads.current.set(url, timer);
      setNotice(`${result.count}장 · A4 ${result.pages}쪽 파일을 만들었어요. 다운로드한 파일을 열어 인쇄하거나 PDF로 저장하세요.`);
    } catch (failure) { if (current() && failure.name !== 'AbortError') { setError(failure.message); setNotice(''); } }
    finally { if (current()) { working.current = false; setBusy(false); } }
  }
  return <div className="builtin-card-print">
    <button type="button" disabled={disabled || busy} onClick={download}><UiIcon name="download" />전체 카드 인쇄 파일</button>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </div>;
}
