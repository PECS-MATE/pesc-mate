import { useEffect, useRef, useState } from 'react';
import { request } from './services/api';
import { importedBoardPlan } from './services/importedBoard';

export default function ImportedBoardOrder({ targetId, cards, disabled = false }) {
  const [layout, setLayout] = useState(null);
  const [mode, setMode] = useState('append');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(false);
  const operation = useRef(0);
  const running = useRef(false);
  const order = cards.map(card => card.id).join('|');
  const currentOrder = useRef(order);
  currentOrder.current = order;
  const currentTarget = useRef(targetId);
  currentTarget.current = targetId;
  const allowed = useRef(!disabled);
  allowed.current = !disabled;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current += 1; };
  }, []);
  useEffect(() => {
    operation.current += 1; setLayout(null); setConfirmed(false); setMessage('');
  }, [targetId, order]);
  useEffect(() => { if (disabled) { operation.current += 1; setLayout(null); setConfirmed(false); } }, [disabled]);
  const query = `?user_id=${encodeURIComponent(targetId)}`;
  const plan = importedBoardPlan(layout, cards, mode);
  const names = new Map([...(layout?.available_cards || []), ...cards].map(card => [card.id, card.label]));

  async function perform(write) {
    if (running.current || disabled || !navigator.onLine || !cards.length) return;
    if (write && (!layout || !confirmed || plan.issues.length || !plan.changed)) return;
    const token = localStorage.getItem('pesc-mate-token');
    if (!token) { setMessage('다시 로그인한 후 카드판을 확인해 주세요.'); return; }
    const sequence = ++operation.current;
    const isCurrent = () => mounted.current && operation.current === sequence && allowed.current
      && currentOrder.current === order && localStorage.getItem('pesc-mate-token') === token;
    const sameScope = () => isCurrent() && currentTarget.current === targetId;
    running.current = true; setBusy(true); setMessage('');
    try {
      const result = await request(`/board/layout${write ? '/slots' : ''}${query}`, write ? {
        method: 'PUT', body: JSON.stringify({ expected_revision: layout.revision, card_ids: plan.after }),
      } : {});
      if (!sameScope()) return;
      setLayout(result); setConfirmed(false);
      if (write) setMessage('카드판에 저장했습니다. 아동 기기에서 최신 구성을 불러오면 적용됩니다.');
    } catch (error) {
      if (!sameScope()) return;
      // Even a lost save response requires a fresh version before another explicit write.
      setLayout(null); setConfirmed(false);
      setMessage(error.status === 409 ? '다른 기기에서 카드판을 변경했습니다. 최신 카드판을 다시 확인해 주세요.'
        : `${error.message} 저장 결과가 불명확하면 최신 카드판을 확인해 주세요.`);
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <section className="imported-board-order" aria-label="가져온 카드 순서 적용">
    <h4>가져온 순서로 카드판 구성</h4>
    <p>저장 완료한 카드 {cards.length}장을 위 목록 순서대로 준비합니다. 사진 등록만으로 카드판은 바뀌지 않습니다.</p>
    <button type="button" disabled={busy || disabled || !cards.length} onClick={() => perform(false)}>최신 카드판과 적용 순서 확인</button>
    {message && <p role="status">{message}</p>}
    {layout && <>
      <label>카드판 적용 방식<select value={mode} disabled={busy || disabled} onChange={event => { setMode(event.target.value); setConfirmed(false); }}>
        <option value="append">기존 슬롯 뒤에 추가</option><option value="replace">가져온 카드 순서로 슬롯 교체</option>
      </select></label>
      <div className="imported-board-preview">
        <div><h5>현재 카드판 ({plan.before.length}장)</h5><ol aria-label="현재 카드판 순서">{plan.before.map((id, index) => <li key={`${index}:${id}`}>{names.get(id) || id}</li>)}</ol></div>
        <div><h5>변경 후 카드판 ({plan.after.length}장)</h5><ol aria-label="적용할 카드판 순서">{plan.after.map((id, index) => <li key={`${index}:${id}`}>{names.get(id) || id}</li>)}</ol></div>
      </div>
      {plan.issues.map(issue => <p role="alert" key={issue}>{issue}</p>)}
      {!plan.changed && <p>이미 같은 순서입니다. 다시 저장하지 않습니다.</p>}
      <p>슬롯 교체는 기존 카드판 위치를 바꿉니다. 카드 사진·문구·빠른 표현·복구 표현은 삭제하거나 바꾸지 않습니다.</p>
      <label className="bulk-crop-option"><input type="checkbox" checked={confirmed} disabled={busy || disabled}
        onChange={event => setConfirmed(event.target.checked)} />변경 전후 순서와 기존 슬롯에 미치는 영향을 확인했습니다</label>
      <button type="button" className="primary" disabled={busy || disabled || !confirmed || !plan.changed || Boolean(plan.issues.length)} onClick={() => perform(true)}>확인한 순서로 카드판 저장</button>
    </>}
  </section>;
}
