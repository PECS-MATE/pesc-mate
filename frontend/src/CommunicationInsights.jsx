import { SPEECH_STATUS } from './CommunicationActivity';

export function CardCombinations({ items = [] }) {
  return <section className="card-combinations" aria-label="함께 사용한 카드 조합">
    <h3>함께 사용한 카드 조합</h3>
    <p className="muted">선택한 기간에 처음 저장한 문장에서 함께 쓰인 두 카드입니다. 순서는 구분하지 않으며,
      같은 카드 반복과 재생성은 중복 집계하지 않습니다. 상위 10개만 표시하며 능력 평가가 아닙니다.</p>
    {items.length ? <ul>{items.map(item => <li key={JSON.stringify(item.cards.map(card => card.id))}>
      <span>{item.cards.map(card => card.label).join(' + ')}</span><strong>{item.count}개 문장</strong>
    </li>)}</ul> : <p className="muted">두 카드를 함께 저장한 기록이 없습니다.</p>}
  </section>;
}

export function SessionDetails({ record, cardPicture, fallbackCards }) {
  const cards = record.card_details?.length ? record.card_details
    : record.cards.map(id => fallbackCards[id] || { id, label: id });
  return <div className="session-details">
    <strong>{record.regeneration_of ? `재생성 ${(record.generation_attempt || 2) - 1}회차` : '문장 생성'}
      {record.generation_source === 'ollama' ? ' · 모델 생성' : record.generation_source === 'rule' ? ' · 규칙 기반' : ' · 생성 방식 기록 없음'}</strong>
    {record.regeneration_of && <small>원본 기록 번호: {record.regeneration_of}</small>}
    <span>저장된 카드 순서</span>
    <ol className="session-card-order">{cards.map((card, index) => <li key={`${card.id}-${index}`}>
      <span>{index + 1}.</span>{cardPicture(card, 'mini-card')}<span>{card.label}</span>
      {record.card_selected_at?.[index] && <time dateTime={record.card_selected_at[index]}>
        선택 {new Date(record.card_selected_at[index]).toLocaleString('ko-KR')}</time>}
    </li>)}</ol>
    <small>문장 저장: <time dateTime={record.created_at}>{new Date(record.created_at).toLocaleString('ko-KR')}</time></small>
    {!record.card_selected_at?.some(Boolean) && <small>카드 선택 시각: 기록 없음</small>}
    {record.speech_results?.length ? <div><span>연결된 기기 재생 결과 (최근 최대 10개 · 실제 청취 확인 아님)</span>
      <ul>{record.speech_results.map(event => <li key={event.id}>{SPEECH_STATUS[event.speech_status] || '결과 확인되지 않음'}
        {' · '}{new Date(event.completed_at || event.occurred_at).toLocaleString('ko-KR')}</li>)}</ul></div>
      : <small>실제 발화 여부: 연결된 결과 기록 없음</small>}
  </div>;
}
