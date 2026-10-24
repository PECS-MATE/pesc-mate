export default function SentenceOrderQuestion({ game, question, artStyle, onChange, onAnswer }) {
  const ids = game.sequenceIds || [];
  const locked = game.phase !== 'playing' || ['correct', 'incorrect'].includes(game.feedback);
  const byId = new Map(question.sequence.map(card => [card.id, card]));
  return <>
    <p className="eyebrow">예문을 보고 같은 카드 순서로 놓아 보세요</p>
    <h3 id="learning-question-title">{question.prompt}</h3>
    <p className="muted">연습용 예문이에요. 지금 하고 싶은 말을 대신 저장하거나 재생하지 않아요.</p>
    <ol className="learning-sentence-model" aria-label="예문 카드 순서">
      {question.sequence.map(card => <li key={card.id}>
        <span className="learning-option-art" aria-hidden="true" style={artStyle(card)} /><strong>{card.label}</strong>
      </li>)}
    </ol>
    <div className="learning-options audio-options" role="group" aria-label="문장 카드 보기">
      {question.options.map(card => <button type="button" key={card.id}
        aria-label={`${card.label} 순서에 담기`} disabled={locked || ids.includes(card.id)}
        onClick={() => onChange([...ids, card.id])}>
        <span className="learning-option-art" aria-hidden="true" style={artStyle(card)} />{card.label}
      </button>)}
    </div>
    <section className="learning-sentence-answer" aria-label="내가 놓은 순서">
      <h4>내가 놓은 순서</h4>
      <ol aria-label="선택한 카드 순서">
        {ids.map((id, index) => <li key={id}>
          <button type="button" disabled={locked} aria-label={`${index + 1}번째 ${byId.get(id)?.label} 빼기`}
            onClick={() => onChange(ids.filter(item => item !== id))}>
            {index + 1}. {byId.get(id)?.label} <span aria-hidden="true">×</span>
          </button>
        </li>)}
      </ol>
      {!ids.length && <p>아래에 놓을 카드를 보기에서 골라 주세요.</p>}
      <p role="status">{ids.length} / {question.sequence.length}장 선택 · 고른 카드를 누르면 뺄 수 있어요.</p>
      <button type="button" className="primary" disabled={locked || ids.length !== question.sequence.length
        || (game.feedback === 'retry' && game.selectedId === ids.join('|'))}
        onClick={() => onAnswer(ids)}>순서 확인</button>
    </section>
  </>;
}
