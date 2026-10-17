import { useEffect, useRef, useState } from 'react';
import { request } from './services/api';

export default function OperationalAlerts({ refreshKey, onReview }) {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const refresh = useRef(null);

  useEffect(() => {
    let active = true;
    let pending = false;
    async function load() {
      if (!active || pending || document.visibilityState === 'hidden') return;
      pending = true;
      setBusy(true);
      try {
        const next = await request('/admin/alerts');
        if (active) { setReport(next); setFailed(false); }
      } catch (error) {
        if (active) {
          if ([401, 403].includes(error.status)) setReport(null);
          setFailed(true);
        }
      } finally {
        pending = false;
        if (active) setBusy(false);
      }
    }
    refresh.current = load;
    load();
    const timer = setInterval(load, 60000);
    document.addEventListener('visibilitychange', load);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
      refresh.current = null;
    };
  }, [refreshKey]);

  return <section className="operational-alerts" aria-labelledby="operational-alerts-title" aria-busy={busy}>
    <div className="operational-alerts-heading"><h2 id="operational-alerts-title">운영 알림</h2>
      <button type="button" onClick={() => refresh.current?.()} disabled={busy}>알림 새로고침</button></div>
    {failed && <p role="status">최신 알림을 확인하지 못했습니다. 마지막 확인 결과가 있다면 아래에 유지합니다. 다시 확인해 주세요.</p>}
    {!report && !failed && <p role="status">운영 상태를 확인하고 있습니다.</p>}
    {report && <>
      <p role="status">{failed ? '이전 확인 결과' : report.status === 'partial' ? '일부 상태 확인 불가' : '확인된 운영 상태'} · 알림 {report.alerts.length}건</p>
      {report.alerts.length ? <ul aria-label="운영 알림 목록">{report.alerts.map(alert => <li key={alert.code} className={alert.severity}>
        <div className="operational-alert-title"><strong>{alert.title}</strong>{alert.count !== null && <span className="operational-alert-count">{alert.count}건</span>}</div>
        <p>{alert.message}</p>
        {alert.action === 'review' && <button type="button" onClick={onReview}>검수 목록 열기</button>}
      </li>)}</ul> : <p>설정된 기준에 해당하는 운영 알림이 없습니다.</p>}
      <small>마지막 확인 {new Date(report.generated_at).toLocaleString('ko-KR')} · 표시 중 1분마다 갱신 · 기기 전체 상태를 보장하지 않습니다.</small>
    </>}
  </section>;
}
