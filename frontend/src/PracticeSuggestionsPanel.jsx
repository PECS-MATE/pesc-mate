import { useEffect, useRef, useState } from 'react';
import { request } from './services/api';
import { createRequestId } from './services/requestId';
import { LEARNING_ACTIVITIES } from './services/learningGame';

export default function PracticeSuggestionsPanel({ accountId, target, onDirectSelect }) {
  const [data, setData] = useState(null), [choice, setChoice] = useState('');
  const [plan, setPlan] = useState(null), [feedback, setFeedback] = useState([]);
  const [draft, setDraft] = useState(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const epoch = useRef(0);
  const token = localStorage.getItem('pesc-mate-token');
  const path = `/practice-suggestions/candidates?user_id=${encodeURIComponent(target.id)}`;
  const current = run => epoch.current === run && token === localStorage.getItem('pesc-mate-token');

  async function reload(run = epoch.current) {
    setBusy(true); setError('');
    try {
      const [result, savedFeedback] = await Promise.all([
        request(`${path}&request_id=${createRequestId()}`, { timeoutMs: 35000 }),
        request(`/practice-suggestions/feedback?user_id=${encodeURIComponent(target.id)}`),
      ]);
      if (current(run)) { setData(result); setFeedback(savedFeedback); setChoice(''); setDraft(null); }
    } catch (failure) { if (current(run)) setError(failure.message); }
    finally { if (current(run)) setBusy(false); }
  }
  useEffect(() => {
    const run = ++epoch.current;
    setData(null); setChoice(''); setDraft(null); setPlan(null); setFeedback([]); setNotice('');
    reload(run);
    return () => { ++epoch.current; };
  }, [accountId, target.id, token]);

  async function toggle() {
    const run = epoch.current;
    setBusy(true); setError(''); setNotice('');
    try {
      await request(`/practice-suggestions/settings?user_id=${encodeURIComponent(target.id)}`, {
        method: 'PUT', body: JSON.stringify({ enabled: !data.personalization.enabled,
          expected_revision: data.personalization.revision }),
      });
      if (current(run)) await reload(run);
    } catch (failure) { if (current(run)) setError(failure.message); }
    finally { if (current(run)) setBusy(false); }
  }
  async function approve() {
    if (!draft || !choice) return;
    const run = epoch.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await request(`/practice-suggestions/start?user_id=${encodeURIComponent(target.id)}`, {
        method: 'POST', body: JSON.stringify({ candidate_id: choice, request_id: createRequestId(),
          question_count: draft.question_count, option_count: draft.option_count,
          repeat_frequency: draft.repeat_frequency, retry_enabled: draft.retry_enabled }),
      });
      if (current(run)) { setPlan(saved); setNotice(`${target.name}님의 연습을 준비했습니다. 아동 계정에서 연습하기를 열어 시작해 주세요.`); }
    } catch (failure) { if (current(run)) setError(failure.message); }
    finally { if (current(run)) setBusy(false); }
  }
  async function rate(planId, rating) {
    const run = epoch.current, prior = feedback.find(item => item.plan_id === planId);
    setBusy(true); setError('');
    try {
      const saved = await request(`/practice-suggestions/feedback/${encodeURIComponent(planId)}?user_id=${encodeURIComponent(target.id)}`, {
        method: 'PUT', body: JSON.stringify({ rating, expected_revision: prior?.revision || 0 }),
      });
      if (current(run)) setFeedback(rows => [saved, ...rows.filter(item => item.plan_id !== planId)]);
    } catch (failure) { if (current(run)) setError(failure.message); }
    finally { if (current(run)) setBusy(false); }
  }
  async function removeFeedback(planId) {
    const run = epoch.current, prior = feedback.find(item => item.plan_id === planId);
    if (!prior) return;
    setBusy(true); setError('');
    try {
      await request(`/practice-suggestions/feedback/${encodeURIComponent(planId)}?user_id=${encodeURIComponent(target.id)}&expected_revision=${prior.revision}`, { method: 'DELETE' });
      if (current(run)) setFeedback(rows => rows.filter(item => item.plan_id !== planId));
    } catch (failure) { if (current(run)) setError(failure.message); }
    finally { if (current(run)) setBusy(false); }
  }
  const selected = data?.candidates?.find(row => row.candidate_id === choice);
  return <article className="practice-suggestions" aria-label="이번에 해볼 연습">
    <h3>이번에 해볼 연습</h3>
    <p>최근 기록으로 익숙한 소재를 제안합니다. 연습은 아동이 직접 시작해요.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {busy && !data ? <p role="status">연습 후보를 확인하고 있어요.</p> : data && <>
      <button type="button" disabled={busy || (data.status === 'consent_required' && !data.personalization.enabled)} onClick={toggle}>
        개인화 연습 {data.personalization.enabled ? '끄기' : '켜기'}</button>
      {data.status === 'consent_required' && <p>기록 동의가 유효하지 않아 개인화 연습을 사용할 수 없습니다.</p>}
      {data.status === 'disabled' && <p>개인화 연습은 꺼져 있습니다. 기존 연습은 계속 선택할 수 있어요.</p>}
      {data.status === 'insufficient' && <p>기록이 아직 충분하지 않습니다. 최근 {data.samples.window_days}일 선택 이벤트 {data.samples.selection_events}건, 완료된 연습 {data.samples.learning_attempts}회입니다. 기존 연습을 직접 선택해 주세요.</p>}
      {data.status === 'no_supported_candidates' && <p>현재 카드와 학습 설정에 맞는 후보가 없습니다.</p>}
      {data.status === 'ready' && <><small>최근 {data.samples.window_days}일 · 카드 선택 {data.samples.selection_events}건 / 연습 완료 {data.samples.learning_attempts}회 · 최대 {data.samples.selection_limit}/{data.samples.attempt_limit}건 조회</small>
        <p>{data.generation_source === 'ollama' ? 'AI가 허용된 연습 중에서 골랐습니다.' : data.model_fallback ? '모델 대신 규칙으로 연습을 골랐습니다.' : '규칙으로 연습을 골랐습니다.'}</p>
        <div className="practice-candidate-list">{data.candidates.map(row => <button type="button" key={row.candidate_id}
          aria-pressed={choice === row.candidate_id} onClick={() => { setChoice(row.candidate_id); setDraft({ ...row.settings }); }}>
          <strong>{LEARNING_ACTIVITIES[row.activity_type]?.title}</strong><small>{row.evidence[0]?.text}</small></button>)}</div>
        {selected && draft && <div className="practice-candidate-preview"><h4>설정 미리보기</h4>
          <p>{LEARNING_ACTIVITIES[selected.activity_type]?.title} · {selected.card_labels.join(' → ')} · {selected.evidence.map(item => item.text).join(' ')}</p>
          <label>문제 수<select value={draft.question_count} onChange={event => setDraft({ ...draft, question_count: Number(event.target.value) })}>{[5, 10, 15, 20, 30].map(value => <option key={value} value={value}>{value}개</option>)}</select></label>
          {selected.activity_type !== 'sentence_card_order' && <label>보기 수<select value={draft.option_count} onChange={event => setDraft({ ...draft, option_count: Number(event.target.value) })}>{[2, 3, 4].map(value => <option key={value} value={value}>{value}개</option>)}</select></label>}
          <label>반복<select value={draft.repeat_frequency} onChange={event => setDraft({ ...draft, repeat_frequency: Number(event.target.value) })}>{[1, 2, 3].map(value => <option key={value} value={value}>{value}회</option>)}</select></label>
          <label><input type="checkbox" checked={draft.retry_enabled} onChange={event => setDraft({ ...draft, retry_enabled: event.target.checked })} />다시 선택할 수 있게 하기</label>
          <button type="button" className="primary" disabled={busy || !navigator.onLine} onClick={approve}>이 설정으로 시작 준비</button>
          <button type="button" onClick={() => { setChoice(''); setDraft(null); }}>나중에</button>
        </div>}
      </>}
      <button type="button" onClick={onDirectSelect}>직접 선택 · 기존 학습 설정 보기</button>
      {plan && <div className="practice-feedback"><strong>방금 준비한 연습에 대한 보호자 의견</strong><div>
        {[['appropriate', '적절함'], ['difficult', '어려움'], ['not_interested', '관심 없음']].map(([value, label]) =>
          <button type="button" key={value} disabled={busy} aria-pressed={feedback.some(item => item.plan_id === plan.id && item.rating === value)} onClick={() => rate(plan.id, value)}>{label}</button>)}
        {feedback.some(item => item.plan_id === plan.id) && <button type="button" disabled={busy} onClick={() => removeFeedback(plan.id)}>의견 삭제</button>}
      </div><small>이 의견은 학습 완료 여부와 별도로 저장됩니다.</small></div>}
      {!!feedback.length && <details><summary>최근 보호자 의견 {feedback.length}건</summary><ul>{feedback.slice(0, 10).map(item => <li key={item.plan_id}>
        {item.candidate_id} · {({ appropriate: '적절함', difficult: '어려움', not_interested: '관심 없음' })[item.rating]}
        <button type="button" disabled={busy} onClick={() => removeFeedback(item.plan_id)}>삭제</button>
      </li>)}</ul></details>}
    </>}
  </article>;
}
