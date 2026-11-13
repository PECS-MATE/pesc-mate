import { isTextOnlyCard } from '../services/cardMedia';
import Mascot, { EmptyState } from "../Mascot";

import UiIcon from "../UiIcon";
import IconButton from "../IconButton";
import CardEditorDialog from "../CardEditorDialog";

import SpeakingCardTile from "../components/SpeakingCardTile";

import PracticeOverview from "../PracticeOverview";
import LearningProgram from "../LearningProgram";

import SpeakingCardLibrary from "../SpeakingCardLibrary";

import LearningQuestion from "../LearningQuestion";
import SentenceOrderQuestion from "../SentenceOrderQuestion";

import { availableSentenceExamples } from "../services/sentenceLearning";

import { artStyle, cardImage } from "../services/cardMedia";

// Pure page rendering. USB and audio controllers remain mounted in App.
export default function CommunicatorPage({ tab, user, privacy, offline, cardCatalog, cards, cardCategories, boardLayout, recoveryExpressions, cardPicture, accessibility, busy, cardArt, speechState, speakText, setTab, learningBusy, learningGame, currentLearningQuestion, changeLearningOrder, answerLearningQuestion, playLearningPrompt, nextLearningQuestion, setLearningGame, startLearningGame, practiceActivity, practiceCategory, practiceCategories, practiceSituation, setPracticeSituation, learningSettings, learningProgress, activePracticePlan, availablePracticeCards, setPracticeActivity, setPracticeCategory, startPracticePlan, search, setSearch, setEditingSubmission, setCardFormError, setShowCardForm, category, setCategory, catalogListRef, scrollCatalog, visibleCards, selectedCard, setSelectedCard, add, cardSubmissions, reviewBusy, submitDraft, loaded, filteredCards, showCardForm, editingSubmission, cardFormBusy, cardFormError, submitCard, outputMode }) {
function tile(card) {
    return <SpeakingCardTile key={card.id} card={card} renderArt={cardArt} disabled={busy}
      compose={outputMode !== 'word'} onAdd={add} onSpeak={item => speakText(item.label, 'card', [item.id])} />;
  }
return (tab === 'home' && user.role === 'user' ? (null) : 
tab === 'cards' && user.role === 'user' ? (<div className="communication-layout">
      {!privacy.guardian_consent && <p className="recordless-notice" role="status">기록 없이 말하기 · 지금 고른 카드와 발화는 저장하지 않아요.</p>}
      <div className="workspace">
      <SpeakingCardLibrary key={`${user.id}:${privacy.guardian_consent}`} accountId={user.id} persistFavorites={privacy.guardian_consent}
        onRefresh={offline ? undefined : cardCatalog.refresh} refreshing={cardCatalog.refreshing} refreshNotice={cardCatalog.notice}
        cards={cards} categories={cardCategories} layout={boardLayout} recoveryCards={recoveryExpressions}
        renderPicture={cardPicture} hasPicture={card => Boolean(cardImage(card))} pageSize={accessibility.cards_per_page} busy={busy}
        renderCard={card => recoveryExpressions.some(item => item.id === card.id)
          ? <SpeakingCardTile card={card} renderArt={cardArt} compose={false} disabled={speechState.status === 'starting'} onSpeak={item => speakText(item.label, 'recovery')} />
          : tile(card)} />
      </div>
    </div>) : 
tab === 'practice' && user.role === 'user' ? (<section className="learning-hub">
      <div className="panel-heading practice-heading"><span aria-hidden="true"><UiIcon name="book" /></span><div><h2>연습하기</h2></div><IconButton icon="message" label="말하기로 이동" className="communication-return" onClick={() => setTab('cards')} /></div>
      {learningBusy ? <p role="status">학습 정보를 불러오는 중입니다…</p> : learningGame?.phase === 'playing' || learningGame?.phase === 'saving' ? <article className="learning-game" aria-labelledby="learning-question-title">
        {learningGame.resumed && <p className="learning-resumed" role="status">저장된 문제부터 이어서 연습해요.</p>}
        <div className="learning-game-progress"><strong>{learningGame.questionIndex + 1} / {learningGame.questions.length}</strong><progress value={learningGame.questionIndex + (learningGame.feedback ? 1 : 0)} max={learningGame.questions.length} /><span>천천히 골라도 괜찮아요.</span></div>
        {currentLearningQuestion && (learningGame.activity_type === 'sentence_card_order' ? <SentenceOrderQuestion
          game={learningGame} question={currentLearningQuestion} artStyle={artStyle}
          onChange={changeLearningOrder} onAnswer={answerLearningQuestion} /> : <LearningQuestion key={`${learningGame.requestId}:${learningGame.questionIndex}`}
          game={learningGame} question={currentLearningQuestion} artStyle={artStyle}
          onAnswer={answerLearningQuestion} onListen={playLearningPrompt} />)}
        <div className={`learning-feedback ${learningGame.feedback || 'waiting'}`} role="status" aria-live="polite">{learningGame.feedback === 'correct' ? '잘 찾았어요! 다음 문제로 가 볼까요?' : learningGame.feedback === 'retry' ? (learningGame.activity_type === 'sentence_card_order' ? '괜찮아요. 카드를 빼고 예문의 순서로 다시 놓아 보세요.' : '괜찮아요. 다른 단어를 다시 골라 보세요.') : learningGame.feedback === 'incorrect' ? (learningGame.activity_type === 'sentence_card_order' ? `예문 순서는 ${currentLearningQuestion.sequence.map(card => card.label).join(' → ')}이에요. 천천히 다시 살펴봐요.` : `괜찮아요. 정답은 ${currentLearningQuestion?.target.label}이에요.`) : learningGame.activity_type === 'sentence_card_order' ? '카드를 놓은 뒤 순서 확인을 눌러 주세요.' : '정답을 골라 주세요.'}</div>
        {['correct', 'incorrect'].includes(learningGame.feedback) && <button className="primary learning-next" disabled={learningGame.phase === 'saving'} onClick={nextLearningQuestion}>{learningGame.phase === 'saving' ? '결과 저장 중…' : learningGame.questionIndex === learningGame.questions.length - 1 ? '연습 마치기' : '다음 문제'}</button>}
      </article> : learningGame?.phase === 'complete' ? <article className="learning-result"><span aria-hidden="true"><UiIcon name="star" size={40} /></span><h3>연습을 마쳤어요!</h3><p>{learningGame.activity_type === 'sentence_card_order' ? '처음 놓은 순서로 ' : '처음 선택으로 '}<strong>{learningGame.attempt?.correct_answers ?? learningGame.correctAnswers}</strong>{learningGame.activity_type === 'sentence_card_order' ? '개 문장을 완성했어요. ' : '개를 찾았어요. '}틀린 문제도 다시 살펴본 것이 중요한 연습이에요.</p>{learningGame.recordingDisabled ? <small>결과를 저장하지 않았습니다.</small> : learningGame.attempt?.pending_sync ? <small>결과를 기기에 저장했습니다. 온라인 연결 후 자동으로 동기화합니다.</small> : learningGame.attempt ? <small>학습 기록에만 안전하게 저장했습니다.</small> : <small>결과가 저장되지 않았습니다. 다시 연결한 뒤 한 번 더 연습해 주세요.</small>}<div><button onClick={() => setLearningGame(null)}>연습 목록</button><button className="primary" onClick={() => startLearningGame(learningGame.plan)}>같은 범위 다시 연습</button></div></article> : <PracticeOverview
        activity={practiceActivity} category={practiceCategory} categories={practiceCategories}
        situation={practiceSituation} onSituation={setPracticeSituation}
        settings={learningSettings} progress={learningProgress} plan={activePracticePlan}
        availableCount={availablePracticeCards().length}
        sentenceExampleCount={practiceActivity === 'sentence_card_order'
          ? availableSentenceExamples(availablePracticeCards()).length : 0}
        onActivity={id => { if (id !== practiceActivity) { setPracticeActivity(id); setPracticeCategory('all'); } }}
        onCategory={setPracticeCategory} onStart={() => startLearningGame()}
        onStartPlan={startPracticePlan} busy={learningBusy} offline={offline} />}
      {!learningGame && <LearningProgram key={`course-${user.id}`} accountId={user.id} targetId={user.id}
        disabled={offline || !privacy.guardian_consent} onStart={startLearningGame} />}
    </section>) : 
tab === 'catalog' && user.role === 'user' ? (<section className="card-catalog">
      <div className="catalog-toolbar">
        <div><h2>카드 보기</h2></div>
        <div className="catalog-actions"><input aria-label="카드 검색" placeholder="카드 이름 검색" value={search} onChange={event => setSearch(event.target.value)} /><button className="primary" onClick={() => { setEditingSubmission(null); setCardFormError(''); setShowCardForm(true); }}><UiIcon name="plus" />카드 등록</button></div>
      </div>
      <div className="categories" aria-label="카테고리">{['전체', ...cardCategories.map(item => item.name)].map(item => <button key={item} aria-pressed={category === item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
      <div className="catalog-layout">
        <div ref={catalogListRef} className="catalog-grid card-scroll-region" role="region" tabIndex="0" aria-label="카드 목록" onScroll={scrollCatalog}>{visibleCards.map(card => <div className="catalog-tile" key={card.id}><button type="button" className="catalog-card" disabled={busy} aria-pressed={selectedCard?.id === card.id} aria-label={`${card.label} 선택하고 말하기`} onClick={() => { setSelectedCard(card); speakText(card.label, 'card', [card.id]); }}>
          {cardArt(card)}
          {!isTextOnlyCard(card) && <span><strong>{card.label}</strong></span>}
        </button></div>)}</div>
        <aside className="card-detail" aria-live="polite">
          {selectedCard ? <>{cardArt(selectedCard, 'detail-art')}<span className="detail-category">{selectedCard.category}</span><h3>{selectedCard.label}</h3><div className="detail-actions"><button className="primary" onClick={() => { if (add(selectedCard)) setTab('cards'); }}>문장에 사용하기</button></div></> : <div className="detail-empty"><Mascot /><strong>카드를 선택해 주세요</strong></div>}
        </aside>
      </div>
      {cardSubmissions.length > 0 && <div className="submission-list"><ul>{cardSubmissions.map(item => <li key={item.id}><span><strong>{item.label}</strong><small>{item.category} · {item.sharing_notice || (item.visibility === 'private' ? '나만 사용' : '공개 요청')}</small></span><div className="submission-actions"><b className={`submission-status ${item.status}`}>{item.visibility === 'private' && item.status === 'approved' ? '나만 사용 중' : ({ draft: '작성 중', pending: '승인 대기', approved: '공개 승인', rejected: '반려', inactive: '비활성' })[item.status] || item.status}</b>{['draft', 'rejected'].includes(item.status) && <button disabled={reviewBusy === item.id} onClick={() => { setEditingSubmission(item); setCardFormError(''); setShowCardForm(true); }}>수정</button>}{item.status === 'draft' && <button className="primary" disabled={reviewBusy === item.id} onClick={() => submitDraft(item)}>{item.visibility === 'private' ? '나만 사용 시작' : '공개 승인 요청'}</button>}</div></li>)}</ul></div>}
      {loaded && !filteredCards.length && <EmptyState>조건에 맞는 카드가 없어요. 다른 검색어나 카테고리를 선택해 보세요.</EmptyState>}
      {showCardForm && <CardEditorDialog key={editingSubmission?.id || 'new-card'} editing={editingSubmission}
        categories={cardCategories} busy={cardFormBusy} error={cardFormError} onSubmit={submitCard}
        onClose={() => { setShowCardForm(false); setEditingSubmission(null); setCardFormError(''); }} />}
    </section>) : <EmptyState>이 화면을 볼 수 있는 연결 권한이 없습니다. 지원 홈에서 사용자를 다시 선택해 주세요.</EmptyState>);
}
