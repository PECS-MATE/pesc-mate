import Mascot from './Mascot';

export default function HomeDashboard({ name, selectedCount, cards = [], renderPicture, onSpeak, onPractice, onCatalog }) {
  const visual = index => <span className="home-activity-pictures" aria-hidden="true">{cards[index] && renderPicture?.(cards[index])}</span>;
  return <section className="home-screen" aria-labelledby="home-activities-title">
    <div className="home-heading"><div><p>{name}님의 소통 공간</p><h2 id="home-activities-title">어떤 이야기를 해볼까요?</h2></div><Mascot className="mascot-heading" /></div>
    <div className="home-mode-grid" aria-label="주요 활동">
      <button type="button" className="home-activity communication" aria-label="말하기 시작" onClick={onSpeak}>
        {visual(0)}<strong>말하기</strong><small>그림이나 실물 카드로 마음을 전해요</small><b aria-hidden="true">→</b>
      </button>
      <button type="button" className="home-activity practice" aria-label="연습 시작하기" onClick={onPractice}>
        {visual(1)}<strong>연습하기</strong><small>그림과 소리, 문장 순서를 익혀요</small><b aria-hidden="true">→</b>
      </button>
      <button type="button" className="home-activity catalog" aria-label="내 카드 살펴보기" onClick={onCatalog}>
        {visual(2)}<strong>내 카드</strong><small>사용할 수 있는 그림카드를 찾아봐요</small><b aria-hidden="true">→</b>
      </button>
    </div>
    {selectedCount > 0 && <button type="button" className="resume-speaking" onClick={onSpeak}>
      고른 카드 {selectedCount}장으로 이어서 말하기 <span aria-hidden="true">→</span>
    </button>}
  </section>;
}

export function CardTopics({ categories, cards, renderPicture, onSelect, onAll }) {
  const topics = categories.map(category => ({ ...category, cards: cards.filter(card => card.category === category.name) }))
    .filter(category => category.cards.length);
  return <section className="home-topics" aria-labelledby="home-topics-title">
    <div className="section-title"><div><h2 id="home-topics-title">주제별 카드</h2><p>관심 있는 주제부터 살펴봐요.</p></div><button type="button" onClick={onAll}>전체 카드 보기</button></div>
    {topics.length ? <div className="topic-grid">{topics.map(category => <button type="button" key={category.id}
      aria-label={`${category.name} 카드 살펴보기`} onClick={() => onSelect(category.name)}>
      <span className="topic-pictures" aria-hidden="true">{category.cards.slice(0, 3).map(card => renderPicture(card))}</span>
      <strong>{category.name}</strong><small>{category.cards.length}개 카드</small><span className="topic-arrow" aria-hidden="true">→</span>
    </button>)}</div> : <p className="muted">카드를 불러오면 사용할 수 있는 주제가 여기에 표시됩니다.</p>}
  </section>;
}
