import { useEffect, useRef, useState } from 'react';
import { request } from './services/api';
import RecordExport from './RecordExport';

export const SITUATIONS = {
  unspecified: '상황 미지정', home: '집', school: '학교', therapy: '치료실', outside: '외출', meal: '식사', hospital: '병원',
};
export const SPEECH_STATUS = { succeeded: '기기 재생 완료', failed: '기기 재생 오류', cancelled: '재생 중지' };
const RECOVERY = { wrong_tap: '잘못 눌렀어요', not_that: '그 뜻이 아니에요', hold_on: '잠깐만요',
  say_again: '다시 말할게요', please_wait: '제 말을 기다려 주세요', dont_understand: '질문을 잘 모르겠어요', yes: '맞아요', no: '아니에요' };

function EventSummary({ event, cards }) {
  if (!event) return <span>이 조회 기간·같은 기기의 5분 이내에 인접 기록 없음</span>;
  return <span>{event.event_type === 'card_selection' ? '카드 선택·순서 변경' : event.recovery_id ? RECOVERY[event.recovery_id] : '카드 표현'}
    {' · '}{(event.card_ids || []).map(id => cards[id]?.label || id).join(' → ') || '선택 카드 없음'}
    {' · '}{SPEECH_STATUS[event.speech_status] || '재생 결과 기록 없음'}
    <time dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleString('ko-KR')}</time></span>;
}

// The parent keys this panel by account, linked user, permission and period.
export default function CommunicationActivity({ targetId, days, cards }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    const token = localStorage.getItem('pesc-mate-token');
    const isCurrent = () => current === generation.current && token
      && localStorage.getItem('pesc-mate-token') === token && navigator.onLine;
    const query = new URLSearchParams({ user_id: targetId });
    if (days !== null) query.set('days', String(days));
    setReport(null); setError('');
    request(`/records/activity?${query}`).then(result => { if (isCurrent()) setReport(result); })
      .catch(failure => { if (isCurrent()) setError(failure.message); });
    return () => { generation.current += 1; };
  }, [targetId, days, reload]);
  return <section className="communication-activity" aria-label="선택·발화·상황 기록">
    <h3>선택·발화·상황 기록</h3>
    <p className="record-scope-note">기기에서 기록한 선택 시각·순서와 재생 결과입니다. 재생 완료는 실제 청취 확인이 아닙니다.
      상황은 사용자가 직접 선택한 값이며 자동 추정하지 않습니다. 과거 기록에는 새 항목이 없을 수 있습니다.
      시간은 기기 시계 기준이며 추이는 UTC 날짜로 묶습니다. 기록이 없는 것을 미사용이나 지원 불필요로 해석하지 마세요.</p>
    {error ? <div role="alert">{error}<button onClick={() => setReload(value => value + 1)}>활동 조회 다시 시도</button></div>
      : !report ? <p role="status">활동 기록을 불러오는 중입니다…</p> : <>
        <p>선택한 기간의 활동 {report.total}건 · 최근 {report.recent_limit}건 표시</p>
        <RecordExport domain="activity" targetId={targetId} days={days} />
        <h4>상황별 사용 추이</h4>
        <p>선택 변경과 발화 결과는 문장 저장·학습 참여 횟수에 합산하지 않습니다. 상황 간 우열이나 진단을 나타내지 않습니다.</p>
        {report.situations.length ? <div className="record-table"><table><caption>직접 지정한 상황별 활동</caption>
          <thead><tr><th>상황</th><th>선택 변경</th><th>재생 완료</th><th>재생 오류</th><th>중지</th><th>이전 요청 기록</th></tr></thead>
          <tbody>{report.situations.map(item => <tr key={item.situation}><th>{item.label}</th><td>{item.selections}</td>
            <td>{item.succeeded}</td><td>{item.failed}</td><td>{item.cancelled}</td><td>{item.legacy_requests}</td></tr>)}</tbody>
        </table></div> : <p>상황별 활동 기록이 없습니다.</p>}
        <details><summary>날짜별 상황 기록 보기 (최근 60개 날짜·상황)</summary>
          <ul>{report.daily.slice(0, 60).map(item => <li key={`${item.date}-${item.situation}`}>{item.date} · {SITUATIONS[item.situation] || SITUATIONS.unspecified}
            {' · '}선택 {item.selections || 0}건 · 발화 결과 {item.speech_results || 0}건 · 이전 요청 {item.legacy_requests || 0}건</li>)}</ul>
        </details>
        <details><summary>최근 선택·발화 시각과 순서</summary><ol className="activity-event-list">{report.recent.map(event => <li key={event.id}>
          <EventSummary event={event} cards={cards} /><small>{SITUATIONS[event.situation] || SITUATIONS.unspecified}
            {event.sequence ? ` · 같은 기기 흐름 내 순서 ${event.sequence}` : ' · 이전 형식 기록'}</small>
        </li>)}</ol></details>
        <h4>복구 표현 사용 전후</h4>
        <p>같은 기기 흐름의 5분 이내 인접 기록만 연결합니다(최근 20개). 표현을 고친 이유나 전달 성공을 판단하지 않습니다.</p>
        {report.recovery_flows.length ? <ol className="recovery-flow-list">{report.recovery_flows.map(flow => <li key={flow.recovery.id}>
          <div><strong>이전</strong><EventSummary event={flow.before} cards={cards} /></div>
          <div><strong>복구 표현</strong><EventSummary event={flow.recovery} cards={cards} /></div>
          <div><strong>이후</strong><EventSummary event={flow.after} cards={cards} /></div>
        </li>)}</ol> : <p>선택한 기간의 복구 표현 기록이 없습니다.</p>}
      </>}
  </section>;
}
