import { useEffect, useRef, useState } from 'react';
import { request } from './services/api';
import { createRequestId } from './services/requestId';
import { LEARNING_ACTIVITIES } from './services/learningGame';
import { programEntries, SITUATIONS } from './services/situationLearning';
import './assets/learningProgram.css';

export default function LearningProgram({ accountId, targetId, manager = false, disabled = false, onStart }) {
  const [data, setData] = useState(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [title, setTitle] = useState(''), [activity, setActivity] = useState('word_picture_match');
  const [situation, setSituation] = useState('meal'), [selected, setSelected] = useState([]);
  const [search, setSearch] = useState(''), [attempts, setAttempts] = useState([]);
  const [courseDay, setCourseDay] = useState(0);
  const epoch = useRef(0), token = localStorage.getItem('pesc-mate-token');
  const query = `?user_id=${encodeURIComponent(targetId)}`;
  const current = run => run === epoch.current && token === localStorage.getItem('pesc-mate-token');
  async function load(run = epoch.current) {
    setBusy(true); setError('');
    try {
      const [program, progress] = await Promise.all([
        request(`/learning/program${query}`), request(`/learning/progress${query}&days=365`),
      ]);
      if (current(run)) { setData(program); setAttempts(progress.recent || []); }
    } catch (e) { if (current(run)) setError(e.message); }
    finally { if (current(run)) setBusy(false); }
  }
  useEffect(() => {
    const run = ++epoch.current; setData(null); setAttempts([]); setSelected([]); setNotice(''); setCourseDay(0);
    if (!disabled) load(run);
    return () => { epoch.current += 1; };
  }, [accountId, targetId, disabled, token]);
  async function save(next) {
    if (!data || busy || disabled) return;
    const run = epoch.current; setBusy(true); setError(''); setNotice('');
    try {
      const { sets, daily_set_ids, starts_on, review_interval_days } = next;
      const saved = await request(`/learning/program${query}`, { method: 'PUT', body: JSON.stringify({
        sets, daily_set_ids, starts_on, review_interval_days, expected_revision: data.revision,
      }) });
      if (current(run)) { setData(saved); setSelected([]); setTitle(''); setNotice('연습 코스를 저장했어요. 아이가 직접 시작할 수 있어요.'); }
    } catch (e) { if (current(run)) setError(e.message); }
    finally { if (current(run)) setBusy(false); }
  }
  function start(row) {
    onStart?.({ id: row.id, program_set_id: row.id, candidate: {
      activity_type: row.activity_type, situation_id: row.situation_id, category_id: 'all', card_ids: row.card_ids,
      settings: { question_count: row.question_count, option_count: row.option_count, repeat_frequency: 1, retry_enabled: true },
    } });
  }
  const entries = programEntries(data, attempts);
  const day = courseDay || entries.day || 1;
  const daySet = data?.daily_set_ids.length ? data.sets.find(row => row.id === data.daily_set_ids[(day - 1) % data.daily_set_ids.length]) : null;
  return <section className="learning-program" aria-label={manager ? '맞춤 연습 코스 관리' : '나의 연습 코스'}>
    <header><h3>{manager ? '맞춤 연습 코스' : '오늘의 연습'}</h3><button type="button" disabled={busy || disabled} onClick={() => load()}>새로고침</button></header>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {busy && <p role="status">코스를 불러오고 있어요.</p>}
    {data && <>
      {!manager && <>
        {daySet && <div><label>일일 코스<select value={day} onChange={e => setCourseDay(Number(e.target.value))}>{Array.from({ length: 30 }, (_, i) => <option key={i} value={i + 1}>Day {i + 1}</option>)}</select></label><button disabled={disabled || busy} onClick={() => start(daySet)}>Day {day} · {daySet.title}</button></div>}
        {entries.reviews.length > 0 && <div><h4>다시 해볼 연습</h4>{entries.reviews.map(row => <button key={row.id} disabled={disabled || busy} onClick={() => start(row)}>{row.title}</button>)}</div>}
        <details><summary>준비된 연습 {data.sets.length}개</summary>{data.sets.map(row => <button key={row.id} disabled={disabled || busy} onClick={() => start(row)}>{row.title}</button>)}</details>
      </>}
      {manager && <>
        <form onSubmit={event => { event.preventDefault(); save({ ...data, sets: [...data.sets, {
          id: createRequestId(), title: title.trim(), activity_type: activity, situation_id: situation,
          card_ids: selected, question_count: 5, option_count: 2,
        }] }); }}>
          <fieldset disabled={busy || disabled || data.sets.length >= 20}>
            <legend>보호자가 고른 카드로 연습 만들기</legend>
            <label>연습 이름<input required maxLength={40} value={title} onChange={e => setTitle(e.target.value)} /></label>
            <label>종류<select value={activity} onChange={e => setActivity(e.target.value)}>{['word_picture_match', 'sound_picture_match', 'situation_card_match'].map(id => <option key={id} value={id}>{LEARNING_ACTIVITIES[id].title}</option>)}</select></label>
            {activity === 'situation_card_match' && <label>상황<select value={situation} onChange={e => setSituation(e.target.value)}>{Object.entries(SITUATIONS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
            <label>카드 찾기<input value={search} onChange={e => setSearch(e.target.value)} /></label>
            <div className="program-card-choices">{data.cards.filter(c => c.label.includes(search)).map(card => <label key={card.id}><input type="checkbox" checked={selected.includes(card.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, card.id] : ids.filter(id => id !== card.id))} />{card.label}</label>)}</div>
            <button className="primary" disabled={!title.trim() || selected.length < 2 || selected.length > 60}>선택한 {selected.length}장으로 세트 추가</button>
          </fieldset>
        </form>
        <div className="program-set-list">{data.sets.map(row => <div key={row.id}><strong>{row.title}</strong><span>{LEARNING_ACTIVITIES[row.activity_type]?.title} · {row.card_ids.length}장</span>
          <button disabled={busy || disabled} onClick={() => save({ ...data, sets: data.sets.filter(s => s.id !== row.id), daily_set_ids: data.daily_set_ids.filter(id => id !== row.id) })}>삭제</button>
          <button disabled={busy || disabled || data.daily_set_ids.length >= 30} onClick={() => setData({ ...data, daily_set_ids: [...data.daily_set_ids, row.id] })}>코스 순서에 추가</button></div>)}</div>
        <fieldset disabled={busy || disabled}>
          <legend>30일 일일 코스 · 복습 일정</legend>
          <label>시작 날짜<input type="date" required value={data.starts_on} onChange={e => setData({ ...data, starts_on: e.target.value })} /></label>
          <label>복습 간격<select value={data.review_interval_days} onChange={e => setData({ ...data, review_interval_days: Number(e.target.value) })}>{[1, 3, 7, 14, 30].map(n => <option key={n} value={n}>{n}일</option>)}</select></label>
          <ol>{data.daily_set_ids.map((id, i) => <li key={i}>{data.sets.find(row => row.id === id)?.title}<button onClick={() => setData({ ...data, daily_set_ids: data.daily_set_ids.filter((_, index) => index !== i) })}>빼기</button></li>)}</ol>
          <p>지정한 순서를 30일 동안 반복해요. 복습은 저장된 완료 기록을 기준으로 제안하며 자동 시작하지 않아요.</p>
          <button className="primary" disabled={!data.starts_on} onClick={() => save(data)}>코스 일정 저장</button>
        </fieldset>
      </>}
    </>}
  </section>;
}
