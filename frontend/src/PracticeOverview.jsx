import { LEARNING_ACTIVITIES } from './services/learningGame';
import { useEffect, useState } from 'react';
import UiIcon from './UiIcon';

const ACTIVITY_ICONS = {
  word_picture_match: 'text',
  sound_picture_match: 'volume',
  sentence_card_order: 'sequence',
};

export default function PracticeOverview({ activity, category, categories, settings, progress,
  availableCount, sentenceExampleCount, plan, onActivity, onCategory, onStart, onStartPlan,
  busy, offline }) {
  const sentence = activity === 'sentence_card_order';
  const canStart = sentence ? sentenceExampleCount > 0 : availableCount >= (settings?.option_count || 3);
  const [customizing, setCustomizing] = useState(() => !canStart);
  useEffect(() => { if (!canStart) setCustomizing(true); }, [canStart]);

  return <div className="practice-overview">
    <div className="practice-start-panel d-flex flex-column flex-lg-row align-items-lg-center gap-3">
      <div><h3>{LEARNING_ACTIVITIES[activity].title}</h3>
        <p>{category === 'all' ? '설정된 카드 전체' : categories.find(item => item.id === category)?.name || '선택한 범위'}
          {settings && ` · ${settings.question_count}문제 · ${sentence ? '예문별 2~3장' : `보기 ${settings.option_count}개`}`}</p>
        {!canStart && <small role="status">{sentence ? '이 범위에는 사용할 예문 카드가 없습니다.' : '이 범위에는 연습에 필요한 카드가 부족합니다.'} 다른 범위를 골라 주세요.</small>}</div>
      <button type="button" className="primary practice-start-action" disabled={!canStart || busy} onClick={onStart}>연습 시작</button>
    </div>
    {plan && <article className="practice-ready d-flex flex-column flex-md-row align-items-md-center gap-3">
      <div className="practice-ready-icon" aria-hidden="true"><UiIcon name="check" size={24} /></div>
      <div className="practice-ready-copy"><span className="practice-kicker">보호자가 준비한 연습</span>
        <h3>{LEARNING_ACTIVITIES[plan.candidate.activity_type]?.title}</h3>
        <p>{plan.candidate.settings.question_count}문제를 준비했어요. 시작할 준비가 되면 눌러 주세요.</p></div>
      <button type="button" className="practice-ready-action" disabled={busy || offline} onClick={onStartPlan}>준비된 연습 시작</button>
    </article>}

    <details className="practice-customize" open={customizing} onToggle={event => setCustomizing(event.currentTarget.open)}>
    <summary>연습 종류·범위 바꾸기</summary>
    <div className="practice-step-heading"><div><h3 id="practice-activity-title">연습 종류</h3></div></div>
    <fieldset className="row g-3 practice-activity-options" disabled={busy} aria-labelledby="practice-activity-title">
      {Object.entries(LEARNING_ACTIVITIES).map(([id, item]) =>
        <div className="col-12 col-md-4" key={id}><label className={`practice-choice${activity === id ? ' selected' : ''}`}>
          <input type="radio" className="visually-hidden" name="practice-activity" value={id} checked={activity === id}
            onChange={() => onActivity(id)} /><span className="practice-choice-icon" aria-hidden="true"><UiIcon name={ACTIVITY_ICONS[id]} size={22} /></span>
          <strong>{item.title}</strong><small>{item.description}</small><span className="practice-choice-check" aria-hidden="true"><UiIcon name="check" /></span></label></div>)}
    </fieldset>

    <div className="practice-step-heading"><div><h3 id="practice-category-title">카드 범위</h3></div></div>
    <fieldset className="practice-category-options d-flex flex-wrap gap-2" disabled={busy} aria-labelledby="practice-category-title">
      {[{ id: 'all', name: '설정된 카드 전체' }, ...categories].map(item =>
        <label className={`practice-category-option${category === item.id ? ' selected' : ''}`} key={item.id}>
          <input type="radio" className="visually-hidden" name="practice-category" value={item.id} checked={category === item.id}
            onChange={() => onCategory(item.id)} /><span aria-hidden="true"><UiIcon name="check" size={18} /></span>{item.name}
        </label>)}
    </fieldset>
    </details>

    <details className="practice-progress-summary"><summary>최근 30일 연습 기록</summary>
      <div className="row g-2 practice-metrics">
        {[[progress?.attempts || 0, '참여 횟수'], [progress?.familiar_words?.length || 0, '반복해서 만나본 단어'],
          [progress?.repeat_words?.length || 0, '다시 연습할 단어']].map(([value, label]) =>
          <div className="col-4" key={label}><div><strong>{value}</strong><span>{label}</span></div></div>)}
      </div>
      {!progress?.attempts && <p className="muted">아직 완료한 연습이 없습니다.</p>}
    </details>
  </div>;
}
