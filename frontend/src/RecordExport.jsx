import { useLayoutEffect, useRef, useState } from 'react';
import { requestBlob } from './services/api';

// Key this component by domain, account, target and period. A closed/replaced view cannot download late data.
export default function RecordExport({ domain, targetId, days, disabled = false }) {
  const generation = useRef(0);
  const pending = useRef(false);
  const enabled = useRef(!disabled);
  enabled.current = !disabled;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => () => { generation.current += 1; }, []);

  async function download(format) {
    if (pending.current || disabled || !navigator.onLine) return;
    const current = ++generation.current;
    const session = localStorage.getItem('pesc-mate-token');
    if (!session) return;
    const isCurrent = () => current === generation.current && enabled.current && navigator.onLine
      && localStorage.getItem('pesc-mate-token') === session;
    pending.current = true; setBusy(true); setError('');
    try {
      const query = new URLSearchParams({ domain, format, user_id: targetId });
      if (days !== null) query.set('days', String(days));
      const blob = await requestBlob(`/api/records/export?${query}`, '기록을 내보내지 못했습니다.');
      if (!isCurrent()) return;
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `pesc-mate-${domain}-${days ?? 'all'}.${format}`;
        anchor.click();
      } finally {
        // Allow the browser to start the download before revoking the temporary URL.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (failure) { if (isCurrent()) setError(failure.message); }
    finally {
      pending.current = false;
      if (current === generation.current) setBusy(false);
    }
  }

  return <section className="record-export" aria-label={domain === 'activity' ? '활동 기록 내보내기' : '기록 내보내기'}>
    <p>현재 영역·조회 기간의 전체 기록을 내려받습니다. 지원 메모와 다른 영역의 기록은 제외됩니다.
      파일에는 개인적인 표현이 포함될 수 있으니 보관·공유에 주의해 주세요. 10,000개 초과 시 기간을 줄여 주세요.</p>
    <div>{['csv', 'json'].map(format => <button key={format} type="button" disabled={disabled || busy}
      onClick={() => download(format)}>{domain === 'activity' ? '활동 ' : ''}{format.toUpperCase()} 내보내기</button>)}</div>
    {busy && <small role="status">기록 파일을 준비하고 있습니다…</small>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
