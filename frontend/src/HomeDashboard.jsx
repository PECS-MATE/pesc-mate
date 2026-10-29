import Mascot from './Mascot';
import UiIcon from './UiIcon';

export default function HomeDashboard({ name, selectedCount, cards = [], renderPicture, onSpeak, onPractice, onCatalog }) {
  const visual = index => <span className="home-activity-pictures" aria-hidden="true">{cards[index] && renderPicture?.(cards[index])}</span>;
  return <section className="home-screen" aria-labelledby="home-activities-title">
    <div className="home-heading"><h2 id="home-activities-title">{name}님, 무엇을 할까요?</h2><Mascot className="mascot-heading" /></div>
    <div className="home-mode-grid" aria-label="주요 활동">
      <button type="button" className="home-activity communication" aria-label={selectedCount ? `고른 카드 ${selectedCount}장으로 이어서 말하기` : '말하기 시작'} onClick={onSpeak}>
        {visual(0)}<strong>{selectedCount ? '이어서 말하기' : '말하기'}</strong><small>{selectedCount ? `고른 카드 ${selectedCount}장이 있어요` : '카드를 골라 말해요'}</small><b aria-hidden="true"><UiIcon name="arrow-right" /></b>
      </button>
      <button type="button" className="home-activity practice" aria-label="연습 시작하기" onClick={onPractice}>
        {visual(1)}<strong>연습하기</strong><small>그림과 소리로 연습해요</small><b aria-hidden="true"><UiIcon name="arrow-right" /></b>
      </button>
    </div>
    <button type="button" className="home-catalog-link" onClick={onCatalog}>내 카드 보기</button>
  </section>;
}

export function CardTopics({ categories, cards, renderPicture, onSelect, onAll }) {
  const topics = categories.map(category => ({ ...category, cards: cards.filter(card => card.category === category.name) }))
    .filter(category => category.cards.length);
  return <details className="home-topics home-topics-disclosure">
    <summary>주제별 카드 보기</summary>
    <div className="section-title"><p>관심 있는 주제부터 살펴봐요.</p><button type="button" onClick={onAll}>전체 카드 보기</button></div>
    {topics.length ? <div className="topic-grid">{topics.map(category => <button type="button" key={category.id}
      aria-label={`${category.name} 카드 살펴보기`} onClick={() => onSelect(category.name)}>
      <span className="topic-pictures" aria-hidden="true">{category.cards.slice(0, 3).map(card => renderPicture(card))}</span>
      <strong>{category.name}</strong><small>{category.cards.length}개 카드</small><span className="topic-arrow" aria-hidden="true"><UiIcon name="chevron-right" /></span>
    </button>)}</div> : <p className="muted">카드를 불러오면 사용할 수 있는 주제가 여기에 표시됩니다.</p>}
  </details>;
}
