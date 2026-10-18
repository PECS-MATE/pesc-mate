import { useEffect, useRef, useState } from 'react';
import { request } from './services/api';

export default function AccountPermissions({ accountId, onSessionExpired }) {
  const active = useRef(false);
  const run = useRef(0);
  const [username, setUsername] = useState('');
  const [target, setTarget] = useState(null);
  const [audit, setAudit] = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    active.current = true;
    const offline = () => {
      run.current += 1;
      setOnline(false);
      setTarget(null); setAudit([]); setPassword(''); setReason(''); setBusy(false); setNotice('');
      setError('운영 권한은 온라인에서만 관리할 수 있습니다. 다시 연결한 뒤 조회해 주세요.');
    };
    const reconnect = () => setOnline(true);
    window.addEventListener('offline', offline);
    window.addEventListener('online', reconnect);
    return () => {
      active.current = false; run.current += 1;
      window.removeEventListener('offline', offline); window.removeEventListener('online', reconnect);
    };
  }, []);
  const current = id => active.current && id === run.current;
  async function lookup(event) {
    event.preventDefault();
    if (!online || busy) return;
    const id = ++run.current;
    setBusy(true); setTarget(null); setAudit([]); setPassword(''); setReason(''); setError(''); setNotice('');
    try {
      const account = await request(`/admin/accounts/lookup?username=${encodeURIComponent(username.trim())}`);
      if (!current(id)) return;
      const history = await request(`/admin/accounts/${encodeURIComponent(account.id)}/permission-audit`);
      if (!current(id)) return;
      setTarget(account); setEnabled(account.content_manage); setAudit(history);
    } catch (failure) {
      if (current(id)) {
        setError(failure.message);
        if (failure.status === 401) onSessionExpired();
      }
    } finally { if (current(id)) setBusy(false); }
  }
  async function save(event) {
    event.preventDefault();
    if (!online || busy || !target) return;
    const id = ++run.current;
    const verification = password;
    setPassword(''); setBusy(true); setError(''); setNotice('');
    try {
      const result = await request(`/admin/accounts/${encodeURIComponent(target.id)}/content-permission`, {
        method: 'PUT', body: JSON.stringify({ content_manage: enabled, expected_revision: target.permission_revision,
          reason: reason.trim(), password: verification }),
      });
      if (!current(id)) return;
      if (result.changed && result.id === accountId) { setTarget(null); setAudit([]); onSessionExpired(); return; }
      setTarget(result); setReason('');
      setNotice(result.changed ? '운영 권한을 변경했습니다. 대상 계정은 다시 로그인해야 합니다.' : '이미 같은 권한입니다. 변경하지 않았습니다.');
      const history = await request(`/admin/accounts/${encodeURIComponent(result.id)}/permission-audit`);
      if (current(id)) setAudit(history);
    } catch (failure) {
      if (current(id)) {
        setTarget(null); setAudit([]); setError(`${failure.message} 대상을 다시 조회해 현재 상태를 확인해 주세요.`);
        if (failure.status === 401) onSessionExpired();
      }
    } finally { if (current(id)) setBusy(false); }
  }
  return <section className="account-permissions" aria-labelledby="account-permissions-title">
    <h2 id="account-permissions-title">운영 권한 관리</h2>
    <p>서버에서 지정한 관리 책임자만 담당자의 공용 콘텐츠 운영 권한을 변경할 수 있습니다. 아동별 지원 권한은 변경하지 않습니다.</p>
    <form onSubmit={lookup}>
      <label>담당자 아이디<input value={username} maxLength="64" required disabled={busy} autoComplete="off" onChange={event => {
        setUsername(event.target.value); setTarget(null); setAudit([]); setPassword(''); setReason(''); setNotice('');
      }} /></label>
      <button disabled={!online || busy || !username.trim()}>담당자 조회</button>
    </form>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {target && <>
      <h3>{target.name} ({target.username})</h3>
      <p>현재 권한: {target.content_manage ? '공용 콘텐츠 운영 가능' : '공용 콘텐츠 운영 불가'} · 버전 {target.permission_revision}</p>
      <form onSubmit={save}>
        <label className="check-setting"><input type="checkbox" checked={enabled} disabled={busy} onChange={event => setEnabled(event.target.checked)} />공용 콘텐츠 운영 허용</label>
        <label>변경 사유<textarea value={reason} minLength="3" maxLength="300" required disabled={busy} placeholder="변경 목적만 기록하고 아동의 개인정보는 입력하지 마세요." onChange={event => setReason(event.target.value)} /></label>
        <label>관리 책임자 비밀번호<input type="password" value={password} maxLength="128" required disabled={busy} autoComplete="current-password" onChange={event => setPassword(event.target.value)} /></label>
        <button className="primary" disabled={!online || busy || enabled === target.content_manage || reason.trim().length < 3 || !password}>{busy ? '확인 중…' : '운영 권한 변경'}</button>
      </form>
      <h3>최근 권한 변경 기록</h3>
      <p>완료되지 않은 기록은 실패를 의미하지 않습니다. 현재 권한·버전을 다시 확인해야 합니다.</p>
      <ul aria-label="운영 권한 감사 기록">{audit.map(row => <li key={row.id}>
        {new Date(row.created_at).toLocaleString('ko-KR')} · 처리자 {row.actor_id} · {row.after ? '부여' : '회수'} ·
        {({ applied: '반영 완료', prepared: '결과 확인 필요', conflict: '충돌·미반영' })[row.status] || '결과 확인 필요'} · {row.reason}
      </li>)}</ul>
      {!audit.length && <p>권한 변경 기록이 없습니다.</p>}
    </>}
  </section>;
}
