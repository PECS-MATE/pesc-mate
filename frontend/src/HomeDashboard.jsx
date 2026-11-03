import UiIcon from './UiIcon';

export default function HomeDashboard({ selectedCount, cards = [], renderPicture, onSpeak, onPractice }) {
  const visual = index => <span className="home-activity-pictures" aria-hidden="true">{cards[index] && renderPicture?.(cards[index], 'home-activity-picture')}</span>;
  return <section className="home-screen" aria-label="말하기와 연습하기">
    <div className="home-mode-grid" aria-label="주요 활동">
      <button type="button" className="home-activity communication" aria-label={selectedCount ? `고른 카드 ${selectedCount}장으로 이어서 말하기` : '말하기 시작'} onClick={onSpeak}>
        {visual(0)}<strong>말하기</strong><b aria-hidden="true"><UiIcon name="arrow-right" /></b>
      </button>
      <button type="button" className="home-activity practice" aria-label="연습 시작하기" onClick={onPractice}>
        {visual(1)}<strong>연습하기</strong><b aria-hidden="true"><UiIcon name="arrow-right" /></b>
      </button>
    </div>
  </section>;
}
