import { EmptyState } from "../Mascot";
import { Avatar } from "../Profile";

import CaregiverHome from "../CaregiverHome";
import A4SharingGallery from "../A4SharingGallery";
import BuiltinCardPrint from "../BuiltinCardPrint";
import UiIcon from "../UiIcon";
import IconButton from "../IconButton";
import CardEditorDialog from "../CardEditorDialog";
import AdminContentPage from "../pages/AdminContentPage";

import PhysicalCardImporter from "../PhysicalCardImporter";
import CardPrintEditor from "../CardPrintEditor";

import AccountPermissions from "../AccountPermissions";

import RecordExport from "../RecordExport";
import { CardCombinations, SessionDetails } from "../CommunicationInsights";
import CommunicationActivity from "../CommunicationActivity";
import NoteHistory from "../NoteHistory";

import PracticeSuggestionsPanel from "../PracticeSuggestionsPanel";

import LearningProgram from "../LearningProgram";
import RecommendationSettings from "../RecommendationSettings";
import CardPhotoReplacement from "../CardPhotoReplacement";
import BoardConfiguration, { SettingsDisclosure } from "../BoardConfiguration";
import CoreCardLocks from "../CoreCardLocks";
import SituationBoards from "../SituationBoards";
import BoardOrganizationSuggestions from "../BoardOrganizationSuggestions";

import RfidBoard from "../RfidBoard";

import RfidChipRegistration from "../RfidChipRegistration";

import { CARD_META, TTS_PRESETS, RECOVERY_EXPRESSIONS, SUPPORT_PERMISSION_LABELS } from "../config/appDefaults";
import { artStyle } from "../services/cardMedia";

// Pure page rendering. USB and audio controllers remain mounted in App.
export default function SupportWorkspacePage({ tab, canManageContent, user, isSupporter, canManageBoard, selectedUser, isCaregiver, changeLinkedUser, linkedUsers, canManageCards, cardCategories, offline, setTab, openSupportSection, openLearning, canManageLearning, canReadRecords, canManageQuick, canManageVoice, selectedPermissions, setEditingSubmission, setCardFormError, setShowCardForm, cardFormBusy, cards, cardSubmissions, statsBusy, loadSupportCards, managedCardSearch, setManagedCardSearch, managedCardCategory, setManagedCardCategory, managedCardNotice, setError, visibleManagedCards, reviewBusy, submitDraft, showCardForm, editingSubmission, cardFormError, submitCard, learningProgress, learningBusy, supportSettingsNotice, learningSettings, saveLearningConfiguration, updateLearningSetting, boardConfigBusy, reloadBoardConfiguration, boardConflict, boardLayout, quickDraft, recoveryDraft, slotDraft, setQuickDraft, setRecoveryDraft, setSlotDraft, saveBoardConfiguration, cardPicture, setBoardLayout, boardLayoutAudit, caregiverSettingsDirty, ttsSettingsBusy, accessibilityBusy, ttsSettings, changeTtsPreset, updateTtsSettings, ttsSettingsSaved, saveTtsSettings, accessibility, updateAccessibility, accessibilitySaved, saveAccessibility, canManageAccounts, handleLogout, adminCategories, adminSubmissions, categoryError, categoryBusy, categoryEdits, setCategoryEdits, addCategory, saveCategory, reviewDrafts, setReviewDrafts, reviewCard, setAdminSubmissions, refreshAdminCards, period, changePeriod, stats, loaded, canWriteNotes, noteDrafts, setNoteDrafts, noteBusy, saveCaregiverNote, removeCaregiverNote }) {

return (tab === 'rfid_registration' && canManageContent ? (<RfidChipRegistration key={user.id} accountId={user.id} artStyle={artStyle} />) : 
tab === 'rfid' && isSupporter && canManageBoard && selectedUser ? (<div>
        <label>{isCaregiver ? '아이 선택' : 'RFID 관리 사용자'}<select value={selectedUser.id} onChange={event => changeLinkedUser(event.target.value)}>
          {linkedUsers.filter(person => person.permissions.includes('board_manage')).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select></label>
        <RfidBoard key={`rfid-${user.id}-${selectedUser.id}-${canManageCards}`} targetId={selectedUser.id} targetName={selectedUser.name} variant={isCaregiver ? 'caregiver' : 'default'} manager canMap={canManageCards} />
      </div>) : 
tab === 'support_home' && isCaregiver ? (<A4SharingGallery key={`sharing-${user.id}`} accountId={user.id} categories={cardCategories} disabled={offline} />) : 
tab === 'caregiver_manage' && isCaregiver ? (<CaregiverHome accountId={user.username || user.id} users={linkedUsers}
        target={selectedUser} offline={offline} onSelect={changeLinkedUser}
        onOpen={next => next === 'rfid' ? setTab('rfid') : openSupportSection(next)} onPractice={() => openLearning(selectedUser)}>
        {selectedUser && canManageLearning && canReadRecords && <PracticeSuggestionsPanel key={`${user.id}:${selectedUser.id}`} variant="caregiver" accountId={user.id} target={selectedUser} onDirectSelect={() => openLearning(selectedUser)} />}
      </CaregiverHome>) : 
tab === 'support_home' && isSupporter ? (<section className="support-home">
        <div className="support-home-panel">
        <div className="panel-heading"><span aria-hidden="true"><UiIcon name="users" /></span><div><h2>{user.role === 'caregiver' ? '보호자 지원 홈' : '담당자 지원 홈'}</h2><p className="muted">연결 사용자를 선택하면 부여된 권한 범위의 메뉴만 표시됩니다.</p></div></div>
        <BuiltinCardPrint accountId={user.id} disabled={offline} />
        {linkedUsers.length ? <><label className="user-picker">지원할 사용자<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)}>{linkedUsers.map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label>
          <div className="support-action-grid">
            {canReadRecords && <button onClick={() => openSupportSection('dashboard')}><span aria-hidden="true"><UiIcon name="chart" /></span><strong>의사소통 기록</strong><small>문장 저장·카드 사용 · 의사소통 기록 조회 권한</small></button>}
            {canManageCards && <button onClick={() => openSupportSection('card_settings')}><span aria-hidden="true"><UiIcon name="cards" /></span><strong>개인 카드 관리</strong><small>연결 사용자 전용 카드 등록과 수정</small></button>}
            {(canManageQuick || canManageBoard) && <button onClick={() => openSupportSection('board_settings')}><span aria-hidden="true"><UiIcon name="grid" /></span><strong>빠른 표현·카드판</strong><small>표현과 카드 위치를 사용자별로 고정</small></button>}
            {canManageVoice && <button onClick={() => openSupportSection('support_settings')}><span aria-hidden="true"><UiIcon name="accessibility" /></span><strong>음성·접근 설정</strong><small>목소리와 화면 표시 방식 조정</small></button>}
            {canManageLearning && <button onClick={() => openLearning(selectedUser)}><span aria-hidden="true"><UiIcon name="book" /></span><strong>학습 기록</strong><small>최근 30일 연습 참여·단어별 기록 · 학습 관리 권한</small></button>}
            {selectedPermissions.includes('notes_write') && <article><span aria-hidden="true"><UiIcon name="check" /></span><strong>{SUPPORT_PERMISSION_LABELS.notes_write}</strong><small>의사소통 기록 화면에서 사용할 수 있습니다.</small></article>}
          </div>
        </> : <EmptyState>연결된 사용자가 없습니다.</EmptyState>}
        </div>
        {selectedUser && canManageLearning && canReadRecords && <PracticeSuggestionsPanel key={`${user.id}:${selectedUser.id}`} accountId={user.id} target={selectedUser} onDirectSelect={() => openLearning(selectedUser)} />}
      </section>) : 
tab === 'card_settings' && isSupporter && canManageCards ? (<section className="card-catalog">
      <div className="caregiver-card-toolbar"><div className="catalog-toolbar"><div><h2>{selectedUser?.name}님의 개인 카드</h2></div><button className="primary" onClick={() => { setEditingSubmission(null); setCardFormError(''); setShowCardForm(true); }}><UiIcon name="plus" />개인 카드 등록</button></div>
      <label className="user-picker">{isCaregiver ? '아이 선택' : '관리 사용자'}<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)} disabled={cardFormBusy}>{linkedUsers.filter(person => person.permissions.includes('cards_manage')).map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label></div>
      {selectedUser && <PhysicalCardImporter key={`physical-${user.id}:${selectedUser.id}`} targetId={selectedUser.id}
        categories={cardCategories} existingCards={[...cards, ...cardSubmissions]} disabled={offline || statsBusy || cardFormBusy}
        onSaved={() => loadSupportCards(selectedUser)} />}
      {user.role === 'caregiver' && selectedUser && <CardPrintEditor key={`print-${user.id}:${selectedUser.id}`}
        targetId={selectedUser.id} targetName={selectedUser.name} categories={cardCategories} existingCards={cardSubmissions}
        disabled={offline || statsBusy || cardFormBusy} onSaved={() => loadSupportCards(selectedUser)} />}
      {isCaregiver && <div className="caregiver-card-search"><label>카드 검색<input value={managedCardSearch} onChange={event => setManagedCardSearch(event.target.value)} placeholder="등록한 카드 이름" /></label>
        <label>분류<select value={managedCardCategory} onChange={event => setManagedCardCategory(event.target.value)}><option value="">모든 분류</option>{[...new Set(cardSubmissions.map(item => item.category))].map(name => <option key={name} value={name}>{name}</option>)}</select></label></div>}
      {isCaregiver && managedCardNotice?.targetId === selectedUser?.id && <div className="caregiver-save-result">
        <p role="status">{selectedUser.name}님의 ‘{managedCardNotice.label}’ 카드를 {managedCardNotice.draft ? '임시 저장했어요. 사용 시작 전에는 아이에게 표시되지 않아요.' : '저장했어요.'}</p>
        <button type="button" onClick={() => { setManagedCardSearch(''); setManagedCardCategory(''); requestAnimationFrame(() => {
          const target = document.getElementById(`managed-card-${managedCardNotice.id}`); target?.scrollIntoView({ block: 'center' }); target?.focus({ preventScroll: true });
        }); }}>등록한 카드 보기</button>
        {canManageBoard && <button type="button" onClick={() => openSupportSection('board_settings')}>카드판 관리로 이동</button>}
      </div>}
      {cardSubmissions.some(item => item.visibility === 'private') && <section className="private-card-photos" aria-label="개인 카드 사진 교체 목록">
        <h3>사진 교체</h3>
        <ul>{cardSubmissions.filter(item => item.visibility === 'private').map(item => <li key={`${user.id}:${selectedUser.id}:${item.id}`}>
          <span>{item.label}</span><CardPhotoReplacement card={item} targetId={selectedUser.id} disabled={offline || statsBusy || cardFormBusy}
            onReplaced={() => loadSupportCards(selectedUser)}
            onRefresh={() => loadSupportCards(selectedUser).catch(failure => setError(failure.message))} />
        </li>)}</ul>
      </section>}
      <div className="submission-list" id="managed-card-list"><h3>등록 카드</h3>{statsBusy ? <p role="status">카드를 불러오고 있어요.</p> : visibleManagedCards.length ? <ul>{visibleManagedCards.map(item => <li key={item.id} id={`managed-card-${item.id}`} tabIndex="-1"><span><strong>{item.label}</strong><small>{item.category}{!isCaregiver && <> · {item.sharing_notice || (item.visibility === 'private' ? '연결 사용자만 사용' : '공개 요청')}</>}</small></span><div className="submission-actions"><b className={`submission-status ${item.status}`}>{item.visibility === 'private' && item.status === 'approved' ? '사용 중' : ({ draft: '작성 중', pending: '승인 대기', approved: '공개 승인', rejected: '반려', inactive: '비활성' })[item.status] || item.status}</b>{['draft', 'rejected'].includes(item.status) && <button disabled={reviewBusy === item.id} onClick={() => { setEditingSubmission(item); setCardFormError(''); setShowCardForm(true); }}>수정</button>}{item.status === 'draft' && <button className="primary" disabled={reviewBusy === item.id} onClick={() => submitDraft(item)}>{item.visibility === 'private' ? '사용 시작' : '공개 승인 요청'}</button>}</div></li>)}</ul> : <div className="caregiver-card-empty"><UiIcon name="cards" size={44} /><strong>{cardSubmissions.length ? '검색 조건에 맞는 카드가 없어요.' : '등록된 개인 카드가 없습니다.'}</strong></div>}</div>
      {showCardForm && <CardEditorDialog key={`${selectedUser?.id}:${editingSubmission?.id || 'new-card'}`}
        editing={editingSubmission} categories={cardCategories} privateOnly targetName={selectedUser?.name}
        targetId={selectedUser?.id} ocrDisabled={offline || statsBusy}
        busy={cardFormBusy} error={cardFormError} onSubmit={submitCard}
        onClose={() => { setShowCardForm(false); setEditingSubmission(null); setCardFormError(''); }} />}
    </section>) : 
tab === 'learning_progress' && isSupporter && canManageLearning ? (<section className="learning-hub"
      role="tabpanel" id="support-record-panel-learning_progress" aria-labelledby="support-record-tab-learning_progress" tabIndex="0">
      <div className="panel-heading"><span aria-hidden="true"><UiIcon name="book" /></span><div><h2>{isCaregiver ? `${selectedUser?.name}님의 연습 관리` : '연결 사용자 학습 기록'}</h2><p className="muted">{selectedUser?.name} · 최근 30일 · 완료한 연습 기준 · 학습 기록 조회·설정 관리 권한</p></div></div>
      {isCaregiver ? <div className="caregiver-record-scope"><p>연습 설정과 최근 30일 연습 기록을 별도로 확인해요.</p><details><summary>기록 해석 안내</summary><p>연습 참여와 단어별 결과이며 문장 저장·카드 사용과 합산하지 않아요. 실제 상황의 의사소통 능력 평가나 진단이 아니에요.</p></details></div> : <p className="record-scope-note">연습 참여 횟수와 단어별 연습 결과만 표시합니다. 문장 저장·카드 사용 횟수에는 합산하지 않으며, 의사소통 능력의 평가나 진단이 아닙니다.</p>}
      {learningProgress && selectedUser && <RecordExport key={`learning-${user.id}-${selectedUser.id}`}
        domain="learning" variant={isCaregiver ? 'caregiver' : 'default'} targetId={selectedUser.id} days={30} disabled={offline || learningBusy} />}
      <label className="user-picker">{isCaregiver ? '아이 선택' : '조회 사용자'}<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)} disabled={learningBusy}>{linkedUsers.filter(person => person.permissions.includes('learning_manage')).map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label>
      {selectedUser && canManageCards && <LearningProgram key={`course-${user.id}:${selectedUser.id}`} manager
        accountId={user.id} targetId={selectedUser.id} disabled={offline || learningBusy} />}
      {learningBusy ? <p role="status">학습 기록을 불러오는 중입니다…</p> : learningProgress && <div className="learning-overview-grid">
        <article><h3>{selectedUser?.name}님의 {isCaregiver ? '연습 설정' : '학습 설정'}</h3>{isCaregiver && supportSettingsNotice?.targetId === selectedUser?.id && <p role="status">{supportSettingsNotice.message}</p>}{learningSettings ? <form className="learning-settings-form" onSubmit={saveLearningConfiguration}><fieldset><legend>학습 카테고리</legend><div className="learning-category-options">{cardCategories.map(item => <label key={item.id}><input type="checkbox" checked={learningSettings.category_ids.includes(item.id)} onChange={event => updateLearningSetting({ category_ids: event.target.checked ? [...learningSettings.category_ids, item.id] : learningSettings.category_ids.filter(id => id !== item.id) })} />{item.name}</label>)}</div></fieldset><div className="learning-setting-fields"><label>문제 수<select value={learningSettings.question_count} onChange={event => updateLearningSetting({ question_count: Number(event.target.value) })}>{[5, 10, 15, 20, 30].map(value => <option key={value} value={value}>{value}개</option>)}</select></label><label>단어 보기 수<select value={learningSettings.option_count} onChange={event => updateLearningSetting({ option_count: Number(event.target.value) })}>{[2, 3, 4].map(value => <option key={value} value={value}>{value}개</option>)}</select></label><label>카드 반복<select value={learningSettings.repeat_frequency} onChange={event => updateLearningSetting({ repeat_frequency: Number(event.target.value) })}>{[1, 2, 3].map(value => <option key={value} value={value}>{value}회</option>)}</select></label><label>권장 시간<select value={learningSettings.time_limit_seconds} onChange={event => updateLearningSetting({ time_limit_seconds: Number(event.target.value) })}>{[30, 60, 120, 300, 600].map(value => <option key={value} value={value}>{value}초</option>)}</select></label></div><label className="privacy-check"><input type="checkbox" checked={learningSettings.retry_enabled} onChange={event => updateLearningSetting({ retry_enabled: event.target.checked })} />다른 보기를 다시 선택할 수 있게 해요</label><button className="primary" disabled={!learningSettings.category_ids.length}>{isCaregiver ? `${selectedUser?.name}님의 연습 설정 저장` : '학습 설정 저장'}</button></form> : <p className="muted">기본 학습 설정을 사용합니다.</p>}</article>
        <article className="learning-word-progress"><h3>{isCaregiver ? '최근 30일 연습 기록' : '최근 30일 학습 흐름'}</h3><div className="learning-metrics"><div><strong>{learningProgress?.attempts || 0}</strong><span>참여 횟수</span></div><div><strong>{learningProgress?.familiar_words?.length || 0}</strong><span>반복해서 만나본 단어</span></div><div><strong>{learningProgress?.repeat_words?.length || 0}</strong><span>다시 연습할 단어</span></div></div>{learningProgress?.last_completed_at ? <p className="muted">최근 참여 {new Date(learningProgress.last_completed_at).toLocaleString('ko-KR')}</p> : <p className="muted">아직 완료한 연습이 없습니다.</p>}<div className="learning-word-groups"><section><h4>반복해서 만나본 단어</h4>{learningProgress?.familiar_words?.length ? <ul>{learningProgress.familiar_words.map(item => <li key={item.card_id}><strong>{item.label}</strong><span>{item.practice_count}번 연습</span></li>)}</ul> : <p className="muted">두 번 이상 연습에서 첫 선택으로 찾은 기록입니다. 실제 상황에서의 이해나 의사소통 능력을 판단하지 않습니다.</p>}</section><section><h4>다시 만나볼 단어</h4>{learningProgress?.repeat_words?.length ? <ul>{learningProgress.repeat_words.map(item => <li key={item.card_id}><strong>{item.label}</strong><span>{item.needs_repeat_count}번 다시 살펴봐요</span></li>)}</ul> : <p className="muted">조금 더 연습할 단어가 없습니다.</p>}</section></div></article>
      </div>}
    </section>) : 
tab === 'board_settings' && isSupporter && (canManageQuick || canManageBoard) ? (<section className="board-settings-panel">
      <div className="panel-heading"><span aria-hidden="true"><UiIcon name="grid" /></span><div><h2>빠른 표현·카드판</h2></div></div>
      <label className="user-picker">{isCaregiver ? '아이 선택' : '설정 사용자'}<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)} disabled={statsBusy}>{linkedUsers.filter(person => person.permissions.some(permission => ['quick_speech_manage', 'board_manage'].includes(permission))).map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label>
      <IconButton icon="refresh" label="저장된 카드판 다시 불러오기" disabled={offline || Boolean(boardConfigBusy) || statsBusy} onClick={() => { if (window.confirm('편집 내용을 버리고 저장된 카드판을 불러올까요?')) reloadBoardConfiguration(); }} />
      {boardConflict && <div className="error" role="alert" data-testid="board-conflict"><span>다른 기기에서 카드판을 변경했습니다. 현재 편집 내용은 화면에 남아 있으며 저장하지 않았습니다. 최신 구성을 불러오면 현재 편집 내용이 바뀝니다.</span><button type="button" disabled={Boolean(boardConfigBusy)} onClick={reloadBoardConfiguration}>최신 카드판 불러오기</button></div>}
      {boardLayout && boardLayout.user_id === selectedUser?.id && <fieldset className="board-config-workspace" aria-label="카드판 구성 편집" disabled={offline || Boolean(boardConfigBusy) || statsBusy || boardConflict}>
        <BoardConfiguration key={`board-editor-${user.id}-${selectedUser.id}`} layout={boardLayout} canManageQuick={canManageQuick} canManageBoard={canManageBoard}
          quick={quickDraft} recovery={recoveryDraft} slots={slotDraft} onQuick={setQuickDraft} onRecovery={setRecoveryDraft} onSlots={setSlotDraft}
          onSave={saveBoardConfiguration} busy={Boolean(boardConfigBusy) || statsBusy || offline || boardConflict} recoveryCards={RECOVERY_EXPRESSIONS} renderPicture={cardPicture}>
        {canManageBoard && selectedUser && <CoreCardLocks key={`${user.id}-${selectedUser.id}`} layout={boardLayout}
          targetId={selectedUser.id} disabled={offline || Boolean(boardConfigBusy) || statsBusy || boardConflict}
          onSaved={setBoardLayout} onRefresh={reloadBoardConfiguration} />}
        {canManageBoard && selectedUser && <SituationBoards key={`situations-${user.id}-${selectedUser.id}`} layout={boardLayout}
          targetId={selectedUser.id} disabled={offline || Boolean(boardConfigBusy) || statsBusy || boardConflict}
          onSaved={setBoardLayout} onRefresh={reloadBoardConfiguration} renderPicture={cardPicture} />}
        {user.role === 'caregiver' && canManageBoard && canReadRecords && selectedUser && boardLayout.user_id === selectedUser.id &&
          <BoardOrganizationSuggestions key={`organization-${user.id}-${selectedUser.id}`}
            layout={boardLayout} targetId={selectedUser.id}
            disabled={offline || Boolean(boardConfigBusy) || statsBusy || boardConflict}
            onSaved={setBoardLayout} onRefresh={reloadBoardConfiguration} renderPicture={cardPicture} />}
        </BoardConfiguration>
      </fieldset>}
      {canManageBoard && selectedUser && <SettingsDisclosure key={`board-recommendation-${user.id}-${selectedUser.id}`} label="추천 설정"><RecommendationSettings key={`${user.id}-${selectedUser.id}`}
        targetId={selectedUser.id} canReadRecords={canReadRecords} /></SettingsDisclosure>}
      <details className="board-extra-settings board-audit"><summary>최근 구성 변경</summary>{boardLayoutAudit.length ? <ul>{boardLayoutAudit.slice(0, 10).map(item => <li key={item.id}><span>{({ recovery_expressions_changed: '복구 표현 변경', quick_expressions_changed: '빠른 표현 변경', board_slots_changed: '카드 슬롯 변경', core_card_locks_changed: '핵심 카드 잠금 변경', recommendation_settings_changed: '추천 설정 변경' })[item.action] || item.action} · 변경자 {item.actor_id}</span><time>{new Date(item.created_at).toLocaleString('ko-KR')}</time></li>)}</ul> : <p className="muted">아직 변경 기록이 없습니다.</p>}</details>
    </section>) : 
tab === 'support_settings' && isSupporter && canManageVoice ? (<section className="support-settings-panel">
      <div className="panel-heading"><span aria-hidden="true"><UiIcon name="accessibility" /></span><div><h2>{isCaregiver ? `${selectedUser?.name}님의 아이 설정` : '음성·접근 설정'}</h2><p className="muted">{selectedUser?.name} 사용자에게 적용할 설정입니다.</p></div></div>
      <label className="user-picker">{isCaregiver ? '아이 선택' : '설정 사용자'}<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)} disabled={statsBusy}>{linkedUsers.filter(person => person.permissions.includes('voice_access_manage')).map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label>
      {isCaregiver && supportSettingsNotice?.targetId === selectedUser?.id && <p role="status">{supportSettingsNotice.message}</p>}
      {isCaregiver && caregiverSettingsDirty && <p className="caregiver-unsaved" role="status">{selectedUser?.name}님의 변경 사항이 아직 저장되지 않았어요.</p>}
      <fieldset className="support-settings-fieldset" disabled={isCaregiver && (statsBusy || ttsSettingsBusy || accessibilityBusy)}><legend className="visually-hidden">아이 음성 및 화면 설정</legend>
      <div className="support-settings-grid">
        <article><h3>목소리 설정</h3>{isCaregiver && <p>이 영역의 저장 버튼은 {selectedUser?.name}님의 목소리에만 적용돼요.</p>}<div className="tts-settings-grid">
          <label>목소리<select value={ttsSettings.preset} onChange={event => changeTtsPreset(event.target.value)}>{Object.entries(TTS_PRESETS).map(([value, preset]) => <option key={value} value={value}>{preset.label}</option>)}</select></label>
          <label>속도 <output>{ttsSettings.rate.toFixed(2)}배</output><input type="range" min="0.5" max="1.5" step="0.05" value={ttsSettings.rate} onChange={event => updateTtsSettings({ rate: Number(event.target.value) })} /></label>
          <label>기본 볼륨 <output>{Math.round(ttsSettings.volume * 100)}%</output><input type="range" min="0" max="1" step="0.05" value={ttsSettings.volume} onChange={event => updateTtsSettings({ volume: Number(event.target.value) })} /></label>
        </div><button className="primary" disabled={ttsSettingsBusy || ttsSettingsSaved} onClick={saveTtsSettings}>{ttsSettingsBusy ? '저장 중…' : ttsSettingsSaved ? '저장됨' : '목소리 저장'}</button></article>
        <article><h3>화면 접근 설정</h3>{isCaregiver && <p>화면 표시와 발화 방식은 여기에서 따로 저장해 주세요.</p>}<div className="support-access-fields">
          <label>시작 화면<select value={accessibility.start_screen} onChange={event => updateAccessibility({ start_screen: event.target.value })}><option value="home">홈</option><option value="cards">그림으로 말하기</option></select></label>
          <label>기본 발화 방식<select value={accessibility.output_mode} onChange={event => updateAccessibility({ output_mode: event.target.value })}><option value="selection">고른 카드 말하기</option><option value="word">단어 즉시 발화</option><option value="natural">자연스러운 문장 생성 사용</option></select></label>
          <label>카드 표시<select value={accessibility.display_mode} onChange={event => updateAccessibility({ display_mode: event.target.value })}><option value="image">그림 중심</option><option value="image_text">그림 + 글자</option><option value="text">글자 중심</option></select></label>
          <label>한 번에 불러올 카드 수<select value={accessibility.cards_per_page} onChange={event => updateAccessibility({ cards_per_page: Number(event.target.value) })}>{[6, 12, 18, 24, 30].map(value => <option key={value} value={value}>{value}개</option>)}</select></label>
          <label>카드 크기<select value={accessibility.card_size} onChange={event => updateAccessibility({ card_size: event.target.value })}><option value="small">작게</option><option value="medium">보통</option><option value="large">크게</option></select></label>
          <label>글자 크기<select value={accessibility.text_size} onChange={event => updateAccessibility({ text_size: event.target.value })}><option value="small">작게</option><option value="medium">보통</option><option value="large">크게</option></select></label>
          <label className="privacy-check"><input type="checkbox" checked={accessibility.reduced_motion} onChange={event => updateAccessibility({ reduced_motion: event.target.checked })} />애니메이션·장식 줄이기</label>
          <label className="privacy-check"><input type="checkbox" checked={accessibility.high_contrast} onChange={event => updateAccessibility({ high_contrast: event.target.checked })} />고대비 표시</label>
          <div className="support-access-preview" aria-label="설정 미리보기"><strong>미리보기 · {accessibility.start_screen === 'home' ? '홈' : '그림으로 말하기'}</strong>
            <div className={`preview-cards size-${accessibility.card_size} display-${accessibility.display_mode}`}>{Array.from({ length: Math.min(3, accessibility.cards_per_page) }, (_, index) => <span key={index}>{['물', '사과', '집'][index]}</span>)}</div>
            <small>한 페이지 {accessibility.cards_per_page}개 · {accessibility.output_mode === 'word' ? '단어 즉시 발화' : accessibility.output_mode === 'natural' ? '자연스러운 문장 생성 사용' : '고른 카드 말하기'}</small>
          </div>
        </div><button className="primary" disabled={accessibilityBusy || accessibilitySaved} onClick={saveAccessibility}>{accessibilityBusy ? '저장 중…' : accessibilitySaved ? '저장됨' : '접근 설정 저장'}</button></article>
      </div></fieldset>
    </section>) : 
tab === 'account_permissions' && canManageAccounts ? (<AccountPermissions key={user.id} accountId={user.id} onSessionExpired={handleLogout} />) : 
tab === 'admin' && canManageContent ? (<AdminContentPage
      user={user} offline={offline} adminCategories={adminCategories} adminSubmissions={adminSubmissions}
      categoryError={categoryError} categoryBusy={categoryBusy} categoryEdits={categoryEdits}
      setCategoryEdits={setCategoryEdits} addCategory={addCategory} saveCategory={saveCategory}
      reviewDrafts={reviewDrafts} setReviewDrafts={setReviewDrafts} reviewBusy={reviewBusy}
      reviewCard={reviewCard} setAdminSubmissions={setAdminSubmissions} refreshAdminCards={refreshAdminCards}
    />) : 
tab === 'dashboard' && isSupporter && canReadRecords ? (<section className="dashboard"
      role={isSupporter ? 'tabpanel' : undefined} id={isSupporter ? 'support-record-panel-dashboard' : undefined}
      aria-labelledby={isSupporter ? 'support-record-tab-dashboard' : undefined} tabIndex={isSupporter ? 0 : undefined}>
      <div className="panel-heading"><span aria-hidden="true"><UiIcon name="chart" /></span><div><h2>{isCaregiver ? `${selectedUser?.name}님의 의사소통 기록` : isSupporter ? '연결 사용자 의사소통 기록' : '나의 의사소통 기록'}</h2>{isSupporter && <p className="muted">{(selectedUser || user).name} · {period === 'all' ? '전체 기간' : `최근 ${period}일`} · 문장 저장 기준 · 의사소통 기록 조회 권한</p>}</div></div>
      {isCaregiver ? <div className="caregiver-record-scope"><p>저장한 문장과 그 안에 포함된 카드만 집계해요.</p><details><summary>집계 기준과 해석 안내</summary><p>연습 결과와 실제 음성 재생 성공 횟수는 이 지표에 포함하지 않아요. 기간 내 저장 기록이며 의도·이해도·능력 평가가 아니에요.</p></details></div> : isSupporter && <p className="record-scope-note">저장한 문장과 그 문장에 포함된 카드만 집계합니다. 연습 결과와 실제 음성 재생 성공 횟수는 이 지표에 포함하지 않습니다.</p>}
      <div className="caregiver-report-toolbar">{isSupporter && selectedUser && <div className="profile"><Avatar user={selectedUser} /><strong>{selectedUser.name}</strong></div>}
      {isSupporter && <label className="user-picker">{isCaregiver ? '아이 선택' : '조회 사용자'}<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)} disabled={statsBusy}>{linkedUsers.filter(person => person.permissions.includes('records_read')).map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label>}
      <div className="period-filter" aria-label="조회 기간">{[['7', '최근 7일'], ['30', '최근 30일'], ['all', '전체']].map(([value, label]) => <button key={value} className={period === value ? 'active' : ''} aria-pressed={period === value} disabled={statsBusy} onClick={() => changePeriod(value)}>{label}</button>)}</div></div>
      {isSupporter && stats && selectedUser && <RecordExport key={`communication-${user.id}-${selectedUser.id}-${period}`}
        domain="communication" variant={isCaregiver ? 'caregiver' : 'default'} targetId={selectedUser.id} days={period === 'all' ? null : Number(period)} disabled={offline || statsBusy} />}
      {statsBusy && <p className="muted" role="status">통계를 불러오는 중입니다…</p>}
      {isSupporter && loaded && !selectedUser && <EmptyState>연결된 사용자가 없습니다.</EmptyState>}
      {stats && <div className={statsBusy ? 'stats-content loading' : 'stats-content'}>
        {isSupporter && <><div className="guardian-summary">
          <div><span>오늘 문장</span><strong>{stats.today_sessions}개</strong></div><div><span>오늘 사용 카드</span><strong>{stats.today_selections}장</strong></div>
          <div><span>자주 사용한 감정·상태 표현</span><strong>{stats.frequent_emotion_state?.label || '기록 없음'}</strong></div><div><span>마지막 표현</span><strong>{stats.last_activity ? new Date(stats.last_activity).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '기록 없음'}</strong></div>
        </div><div className="guardian-grid"><article className="activity-panel"><h3>최근 7일 의사소통</h3><div className="activity-chart">{stats.daily_activity.map(day => { const max = Math.max(...stats.daily_activity.map(item => item.sessions), 1); return <div key={day.date}><span className="activity-value">{day.sessions}</span><i style={{ height: `${Math.max((day.sessions / max) * 100, 4)}%` }}></i><time>{new Date(`${day.date}T00:00:00`).toLocaleDateString('ko-KR', { weekday: 'short' })}</time></div>; })}</div></article>
          <article className="attention-panel"><h3>최근 안전 관련 표현</h3><p className="safety-note">위험을 자동 판단하는 항목이 아니며, 최근 의사표현을 확인하기 위한 기록입니다.</p>{stats.recent_safety_expressions.length ? stats.recent_safety_expressions.map(item => <div className="attention-item" key={item.id}>{cardPicture(item)}<span><strong>{item.label} · {item.count}회</strong><small>최근 {new Date(item.last_used_at).toLocaleString('ko-KR')}</small></span></div>) : <p className="muted">선택한 기간에 안전 관련 표현 기록이 없어요.</p>}</article>
        </div></>}
        <div className="metrics"><div>저장한 문장<strong>{stats.sessions}개</strong></div><div>사용한 카드<strong>{stats.selections}장</strong></div></div>
        <div className="report-breakdown">
          <article><h3>카테고리별 사용</h3>{Object.entries(stats.categories).length ? Object.entries(stats.categories).map(([name, count]) => <div className="bar" key={name}><span>{name}</span><meter min="0" max={Math.max(stats.selections, 1)} value={count} /><strong>{count}회</strong></div>) : <p className="muted">저장된 카드 사용 기록이 없습니다.</p>}</article>
          <article><h3>자주 사용한 카드</h3>{stats.top_cards.length ? <ol className="report-card-ranking">{stats.top_cards.slice(0, 8).map((c, index) => <li key={c.id}><span className="report-rank">{index + 1}</span><strong>{c.symbol} {c.label}</strong><span>{c.count}회</span></li>)}</ol> : <p className="muted">자주 사용한 카드가 아직 없습니다.</p>}</article>
        </div>
        {isSupporter && <CardCombinations items={stats.top_combinations} />}
        {isSupporter && selectedUser && <CommunicationActivity key={`activity-${user.id}-${selectedUser.id}-${period}`}
          targetId={selectedUser.id} variant={isCaregiver ? 'caregiver' : 'default'} days={period === 'all' ? null : Number(period)}
          cards={{ ...CARD_META, ...Object.fromEntries(stats.top_cards.map(card => [card.id, card])) }} />}
        <h3>{isSupporter ? '최근 의사소통 타임라인' : '최근 문장'}</h3>{!stats.recent.length ? <EmptyState>선택한 기간에 기록이 없어요.</EmptyState> : <ul className="history">{stats.recent.map(r => <li key={r.id}>
          {isSupporter && <SessionDetails record={r} cardPicture={cardPicture} fallbackCards={CARD_META} />}<span>{r.sentence}</span>
          {!isSupporter && <time>{new Date(r.created_at).toLocaleString('ko-KR')}</time>}
          {isSupporter && canWriteNotes && <div className="caregiver-note">
            <textarea aria-label={`${r.sentence} 지원 메모`} maxLength="500" placeholder="관찰한 상황과 필요한 지원을 메모해 주세요" value={noteDrafts[r.id] ?? r.caregiver_note ?? ''}
              onChange={event => setNoteDrafts(current => ({ ...current, [r.id]: event.target.value }))} />
            <div><small>{(noteDrafts[r.id] ?? r.caregiver_note ?? '').length}/500</small><button disabled={noteBusy === r.id} onClick={() => saveCaregiverNote(r.id)}>메모 저장</button>
              {r.caregiver_note && <button disabled={noteBusy === r.id} onClick={() => removeCaregiverNote(r.id)}>삭제</button>}</div>
            <NoteHistory key={`${user.id}-${selectedUser.id}-${r.id}-${r.caregiver_note_details?.revision || 0}`}
              targetId={selectedUser.id} sessionId={r.id} details={r.caregiver_note_details} authorName={user.name} />
          </div>}
        </li>)}</ul>}</div>}
      </section>) : <EmptyState>이 화면을 볼 수 있는 연결 권한이 없습니다. 지원 홈에서 사용자를 다시 선택해 주세요.</EmptyState>);
}
