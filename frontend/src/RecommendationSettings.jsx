import { useEffect, useRef, useState } from 'react';
import { request } from './services/api';
import { SITUATIONS } from './CommunicationActivity';

export default function RecommendationSettings({ targetId, canReadRecords = false }) {
  const sequence = useRef(0);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [monitoring, setMonitoring] = useState(null);
  const token = localStorage.getItem('pesc-mate-token');
  const current = value => sequence.current === value && token && navigator.onLine
    && localStorage.getItem('pesc-mate-token') === token;
  useEffect(() => {
    const value = ++sequence.current;
    setDraft(null); setBusy(true); setError('');
    request(`/recommendations/settings?user_id=${encodeURIComponent(targetId)}`)
      .then(result => { if (current(value)) setDraft(result); })
      .catch(failure => { if (current(value)) setError(failure.message); })
      .finally(() => { if (current(value)) setBusy(false); });
    return () => { sequence.current += 1; };
  }, [targetId, reload]);
  function change(key, value) { setDraft(previous => ({ ...previous, [key]: value })); setNotice(''); }
  function toggle(key, id) {
    const next = draft[key].includes(id) ? draft[key].filter(value => value !== id) : [...draft[key], id];
    change(key, next);
  }
  async function save(event) {
    event.preventDefault();
    const value = ++sequence.current;
    setBusy(true); setError(''); setNotice('');
    const body = Object.fromEntries(['enabled', 'mode', 'approved_card_ids', 'hidden_card_ids', 'situation', 'use_time_of_day'].map(key => [key, draft[key]]));
    body.expected_revision = draft.revision;
    try {
      const saved = await request(`/recommendations/settings?user_id=${encodeURIComponent(targetId)}`, {
        method: 'PUT', body: JSON.stringify(body),
      });
      if (current(value)) { setDraft(previous => ({ ...previous, ...saved })); setNotice('추천 설정을 저장했습니다. 고정 카드판은 바꾸지 않았습니다.'); }
    } catch (failure) { if (current(value)) setError(failure.message); }
    finally { if (current(value)) setBusy(false); }
  }
  async function inspect() {
    const value = ++sequence.current;
    setBusy(true); setError('');
    try {
      const report = await request(`/recommendations/monitoring?user_id=${encodeURIComponent(targetId)}`);
      if (current(value)) setMonitoring(report);
    } catch (failure) { if (current(value)) setError(failure.message); }
    finally { if (current(value)) setBusy(false); }
  }
  return <section className="recommendation-settings" aria-label="추천 통제 설정">
    <h3>추천 통제·탐색 보조</h3><p>보드 구성 관리 권한으로 연결 사용자의 추천만 설정합니다.
      숨김은 추천에서만 적용되며 전체 카드북·긴급·복구 표현·고정 위치는 바꾸지 않습니다.</p>
    {error && <p role="alert">{error} 초안은 자동으로 덮어쓰지 않습니다.</p>}
    <button type="button" disabled={busy} onClick={() => {
      if (!draft || window.confirm('현재 초안을 버리고 최신 추천 설정을 불러올까요?')) setReload(value => value + 1);
    }}>최신 추천 설정 불러오기</button>
    {busy && <p role="status">추천 설정을 처리하고 있습니다…</p>}
    {draft && <form onSubmit={save}><fieldset disabled={busy}>
      <label><input type="checkbox" checked={draft.enabled} onChange={event => change('enabled', event.target.checked)} />추천 사용</label>
      <label>추천 허용 방식<select value={draft.mode} onChange={event => change('mode', event.target.value)}>
        <option value="automatic">기록 기반 후보</option><option value="approval">승인한 카드만</option></select></label>
      <label>추천에 반영할 상황<select value={draft.situation} onChange={event => change('situation', event.target.value)}>
        {Object.entries(SITUATIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label><input type="checkbox" checked={draft.use_time_of_day} onChange={event => change('use_time_of_day', event.target.checked)} />기기의 현재 시간대 반영</label>
      <p>승인 목록이 비어 있으면 승인 전용 추천은 표시하지 않습니다. 승인·숨김은 각각 최대 100개이며 같은 카드를 동시에 지정할 수 없습니다.</p>
      <div className="recommendation-policy-cards">{draft.available_cards.map(card => <div key={card.id}><strong>{card.label}</strong>
        <label><input type="checkbox" checked={draft.approved_card_ids.includes(card.id)} onChange={() => toggle('approved_card_ids', card.id)} />{card.label} 추천 승인</label>
        <label><input type="checkbox" checked={draft.hidden_card_ids.includes(card.id)} onChange={() => toggle('hidden_card_ids', card.id)} />{card.label} 추천 숨김</label>
      </div>)}</div><button className="primary" type="submit">추천 설정 저장</button>
    </fieldset></form>}
    {notice && <p role="status">{notice}</p>}
    {draft?.history?.length > 0 && <details><summary>최근 추천 설정 변경 이력</summary><ul>{draft.history.map(item => <li key={item.id}>
      변경자 {item.actor_id} · 버전 {item.after_revision} · {new Date(item.created_at).toLocaleString('ko-KR')}
    </li>)}</ul></details>}
    <p>최근 기록·조합·시간대·지정 상황은 후보의 근거일 뿐 의도·필요·능력 판단이 아닙니다.
      한 카테고리 최대 2개와 반복 노출 완화로 일부 후보가 적게 표시될 수 있습니다.</p>
    {canReadRecords ? <><button type="button" disabled={busy} onClick={inspect}>추천 반복 노출 점검</button>
      {monitoring && <div className="recommendation-monitoring"><p>최근 90일 내 표시 기록 최대 {monitoring.limit}개 중 {monitoring.sampled_batches}개 표본</p>
        <p>{monitoring.notice}</p><p>알고리즘: {monitoring.algorithm_versions.join(', ') || '기록 없음'}</p>
        <p>최근 3회 연속 표시된 카드: {monitoring.repeated_card_ids.map(id => draft?.available_cards.find(card => card.id === id)?.label || id).join(', ') || '해당 기록 없음'}</p>
        <ul>{Object.entries(monitoring.categories).map(([name, count]) => <li key={name}>{name}: {count}개 후보 노출</li>)}</ul>
        <ul>{monitoring.cards.map(item => <li key={item.id}>{draft?.available_cards.find(card => card.id === item.id)?.label || item.id}
          {' · '}표시 {item.exposed_batches}회 · 선택한 표시 묶음 {item.selected_batches}회</li>)}</ul>
      </div>}</> : <p>반복 노출 점검에는 별도의 의사소통 기록 조회 권한이 필요합니다.</p>}
  </section>;
}
