import { LEARNING_ACTIVITIES } from './services/learningGame';

const ACTIVITY_ICONS = {
  word_picture_match: '가',
  sound_picture_match: '♪',
  sentence_card_order: '↔',
};

export default function PracticeOverview({ activity, category, categories, settings, progress,
  availableCount, sentenceExampleCount, plan, onActivity, onCategory, onStart, onStartPlan,
  busy, offline }) {
  const sentence = activity === 'sentence_card_order';
  const canStart = sentence ? sentenceExampleCount > 0 : availableCount >= (settings?.option_count || 3);

  return <div className="practice-overview">
    {plan && <article className="practice-ready d-flex flex-column flex-md-row align-items-md-center gap-3">
      <div className="practice-ready-icon" aria-hidden="true">✓</div>
      <div className="practice-ready-copy"><span className="practice-kicker">보호자가 준비한 연습</span>
        <h3>{LEARNING_ACTIVITIES[plan.candidate.activity_type]?.title}</h3>
        <p>{plan.candidate.settings.question_count}문제를 준비했어요. 시작할 준비가 되면 눌러 주세요.</p></div>
      <button type="button" className="primary practice-ready-action" disabled={busy || offline} onClick={onStartPlan}>이 연습 시작</button>
    </article>}

    <div className="practice-step-heading"><span aria-hidden="true">1</span><div><h3 id="practice-activity-title">어떤 연습을 할까요?</h3><p>하고 싶은 연습을 하나 골라 주세요.</p></div></div>
    <div className="row g-3 practice-activity-options" role="group" aria-labelledby="practice-activity-title">
      {Object.entries(LEARNING_ACTIVITIES).map(([id, item]) =>
        <div className="col-12 col-md-4" key={id}><button type="button" className="practice-choice" aria-pressed={activity === id}
          onClick={() => onActivity(id)}><span className="practice-choice-icon" aria-hidden="true">{ACTIVITY_ICONS[id]}</span>
          <strong>{item.title}</strong><small>{item.description}</small><span className="practice-choice-check" aria-hidden="true">✓</span></button></div>)}
    </div>

    <div className="practice-step-heading"><span aria-hidden="true">2</span><div><h3 id="practice-category-title">무엇으로 연습할까요?</h3><p>카드 범위를 골라 주세요.</p></div></div>
    <div className="practice-category-options d-flex flex-wrap gap-2" role="group" aria-labelledby="practice-category-title">
      <button type="button" aria-pressed={category === 'all'} onClick={() => onCategory('all')}>설정된 카드 전체</button>
      {categories.map(item => <button type="button" key={item.id} aria-pressed={category === item.id}
        onClick={() => onCategory(item.id)}>{item.name}</button>)}
    </div>

    <div className="practice-start-panel d-flex flex-column flex-lg-row align-items-lg-center gap-3">
      <div><span className="practice-kicker">선택한 연습</span><h3>{LEARNING_ACTIVITIES[activity].title}</h3>
        <p>{category === 'all' ? '설정된 카드 전체' : categories.find(item => item.id === category)?.name || '선택한 범위'}
          {settings && ` · ${settings.question_count}문제 · ${sentence ? '예문별 2~3장' : `보기 ${settings.option_count}개`}`}</p>
        {sentence && <small>예문에 있는 카드만 사용해요. 단어 보기 수 설정은 적용하지 않아요.</small>}
        {!canStart && <small role="status">{sentence ? '이 범위에는 사용할 예문 카드가 없습니다.' : '이 범위에는 연습에 필요한 카드가 부족합니다.'} 다른 범위를 골라 주세요.</small>}</div>
      <button type="button" className="primary practice-start-action" disabled={!canStart || busy} onClick={onStart}>연습 시작</button>
    </div>

    <article className="practice-progress-summary"><div><h3>최근 30일 연습</h3><p>연습 결과는 말하기 기록과 따로 저장돼요.</p></div>
      <div className="row g-2 practice-metrics">
        {[[progress?.attempts || 0, '참여 횟수'], [progress?.familiar_words?.length || 0, '반복해서 만나본 단어'],
          [progress?.repeat_words?.length || 0, '다시 연습할 단어']].map(([value, label]) =>
          <div className="col-4" key={label}><div><strong>{value}</strong><span>{label}</span></div></div>)}
      </div>
      {!progress?.attempts && <p className="muted">아직 완료한 연습이 없습니다.</p>}
    </article>
  </div>;
}
