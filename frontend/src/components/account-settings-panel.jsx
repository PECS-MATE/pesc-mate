import { ProfileEditor } from '../Profile';
import AccountSettingsDialog from '../AccountSettingsDialog';
import UiIcon from '../UiIcon';
import DeletionReceipt from '../DeletionReceipt';
import { TTS_PRESETS, SUPPORT_PERMISSION_LABELS } from '../config/appDefaults';

// Rendering only: state, permissions and persistence remain with their owning hooks.
export default function AccountSettingsPanel({
  user, profileSaved, setMyPageOpen,
  accessibility, updateAccessibility, accessibilityBusy,
  accessibilitySaved, saveAccessibility, ttsSettings,
  changeTtsPreset, updateTtsSettings, busy,
  ttsSettingsBusy, offline, speakText,
  ttsSettingsSaved, saveTtsSettings, privacy,
  privacyDraft, privacyBusy, loaded,
  setPrivacyDraft, savePrivacySettings, privacyCaregivers,
  removePrivacyCaregiver, supportPermissionDrafts, setSupportPermissionDrafts,
  toggleSupportPermission, saveSupportPermissions, addPrivacyCaregiver,
  caregiverUsername, setCaregiverUsername, newSupportPermissions,
  setNewSupportPermissions, privacyAudit, downloadPrivacyData,
  deletePrivacyData, localDeletionStatus, isSupporter,
  isCaregiver, selectedUser, canManageCards,
  openSupportSection, canManageQuick, canManageBoard,
  canManageVoice, canManageLearning, openLearning,
  setTab, canManageContent, canManageAccounts,
  compactSidebar, sidebarOpenRef, accountButtonRef,
  profileNotice, error
}) {
  function navigateFromMyPage(action) { setMyPageOpen(false); action(); }
  const settingsSections = [
    { id: 'profile', label: '프로필 설정', content: <ProfileEditor key={user.id} user={user}
      onSaved={profileSaved} onCancel={() => setMyPageOpen(false)} /> },
    ...(user.role === 'user' ? [
      { id: 'accessibility', label: '접근 설정', content: <section className="accessibility-settings"><h3>접근 설정</h3><div>
        <p>시작 화면·발화 방식·카드 배치는 연결된 보호자 또는 담당자 계정에서 바꿀 수 있어요.</p>
        <label>카드 표시<select disabled value={accessibility.display_mode}><option value="image">그림 중심</option><option value="image_text">그림 + 글자</option><option value="text">글자 중심</option></select></label>
        <label>한 번에 불러올 카드 수<select disabled value={accessibility.cards_per_page}><option value={accessibility.cards_per_page}>{accessibility.cards_per_page}개</option></select></label>
        <label>카드 크기<select disabled value={accessibility.card_size}><option value={accessibility.card_size}>{accessibility.card_size === 'small' ? '작게' : accessibility.card_size === 'large' ? '크게' : '보통'}</option></select></label>
        <label>글자 크기<select value={accessibility.text_size} onChange={event => updateAccessibility({ text_size: event.target.value })}><option value="small">작게</option><option value="medium">보통</option><option value="large">크게</option></select></label>
        <label className="check-setting"><input type="checkbox" checked={accessibility.reduced_motion} onChange={event => updateAccessibility({ reduced_motion: event.target.checked })} />애니메이션·장식 줄이기</label>
        <label className="check-setting"><input type="checkbox" checked={accessibility.high_contrast} onChange={event => updateAccessibility({ high_contrast: event.target.checked })} />고대비 표시</label>
        <button className="primary" disabled={accessibilityBusy || accessibilitySaved} onClick={saveAccessibility}>{accessibilityBusy ? '저장 중…' : accessibilitySaved ? '저장됨' : '설정 저장'}</button>
      </div></section> },
      { id: 'voice', label: '음성 설정', content: <section className="tts-settings">
          <h3>음성 설정</h3>
          <p className="form-notice">{import.meta.env.VITE_TTS_PROVIDER === 'qwen3-tts' ? '기본 속도는 0.90배예요. 한 번 만든 기본 카드 음성은 저장해 다시 사용해요.' : '두 합성 음색은 Qwen 연결 시 사용할 수 있어요. 현재 서버는 단일 음색을 사용해요.'}</p>
          <div className="tts-settings-grid">
            <label>목소리<select value={ttsSettings.preset} onChange={event => changeTtsPreset(event.target.value)}>{Object.entries(TTS_PRESETS).map(([value, preset]) => <option key={value} value={value}>{preset.label}</option>)}</select></label>
            <label>속도 <output>{ttsSettings.rate.toFixed(2)}배</output><input type="range" min="0.5" max="1.5" step="0.05" value={ttsSettings.rate} onChange={event => updateTtsSettings({ rate: Number(event.target.value) })} /></label>
            <label>기본 볼륨 <output>{Math.round(ttsSettings.volume * 100)}%</output><input type="range" min="0" max="1" step="0.05" value={ttsSettings.volume} onChange={event => updateTtsSettings({ volume: Number(event.target.value) })} /></label>
          </div>
          <div className="tts-preview"><span>
            <button type="button" disabled={busy || ttsSettingsBusy || offline} onClick={() => speakText('도와주세요', 'preview')}>미리 듣기</button>
            <button type="button" className="primary" disabled={ttsSettingsBusy || ttsSettingsSaved} onClick={saveTtsSettings}>{ttsSettingsBusy ? '저장 중…' : ttsSettingsSaved ? '저장됨' : '설정 저장'}</button></span></div>
        </section> },
      { id: 'guardian', label: '보호자 설정', content: <div className="guardian-settings">
        <h3>보호자 설정</h3><p>계정 소유자·법정대리인이 동의와 데이터 관리를 확인하는 영역입니다.</p>
        <section className="privacy-panel">
      <div className="panel-heading"><span aria-hidden="true"><UiIcon name="shield" /></span><div><h2>개인정보와 열람 권한</h2><p className="muted">누가 기록을 볼 수 있는지 확인하고 내 데이터를 관리합니다.</p></div></div>
      {privacy.deletion_status === 'completed' && <p className="privacy-receipt" role="status">이용 데이터 삭제 완료 · {privacy.deleted_at ? new Date(privacy.deleted_at).toLocaleString('ko-KR') : ''}</p>}
      <div className="privacy-grid">
        <article><h3>동의와 보존 기간</h3><p>보호자 설정입니다. 저장된 동의는 다음 로그인에도 유지되며, 저장하기 전 체크만 바꾼 상태는 기록 수집에 적용하지 않습니다. 동의 없이도 기본 말하기와 기록 없는 연습을 사용할 수 있습니다.</p><label className="privacy-check"><input type="checkbox" checked={privacyDraft.guardian_consent} disabled={privacyBusy === 'settings' || offline || !loaded} onChange={event => setPrivacyDraft(current => ({ ...current, guardian_consent: event.target.checked }))} />법정대리인이 개인정보 수집·이용에 동의했음을 확인합니다.</label><label>기록 보존 기간<select value={privacyDraft.retention_days} disabled={privacyBusy === 'settings' || offline || !loaded} onChange={event => setPrivacyDraft(current => ({ ...current, retention_days: Number(event.target.value) }))}><option value="30">30일</option><option value="90">90일</option><option value="365">1년</option><option value="1095">3년</option></select></label><p className="muted">기간이 지난 문장·음성 이력은 설정 저장 시 삭제됩니다.</p><button className="primary" disabled={privacyBusy === 'settings' || offline || !loaded} onClick={savePrivacySettings}>{privacyBusy === 'settings' ? '저장 중…' : '동의 및 기간 저장'}</button></article>
        <article className="support-access-manager"><h3>보호자·담당자 연결</h3>{privacyCaregivers.length ? <ul className="privacy-caregivers">{privacyCaregivers.map(item => <li key={item.supporter_id}><div className="support-link-heading"><span><strong>{item.name}</strong><small>{item.username} · {item.role === 'caregiver' ? '보호자' : '지원 담당자'}</small></span><button disabled={privacyBusy === item.supporter_id} onClick={() => removePrivacyCaregiver(item)}>연결 해제</button></div><div className="permission-options">{Object.entries(SUPPORT_PERMISSION_LABELS).map(([permission, label]) => <label key={permission}><input type="checkbox" checked={(supportPermissionDrafts[item.supporter_id] || item.permissions).includes(permission)} onChange={() => setSupportPermissionDrafts(current => ({ ...current, [item.supporter_id]: toggleSupportPermission(current[item.supporter_id] || item.permissions, permission) }))} />{label}</label>)}</div><button className="primary" disabled={privacyBusy === item.supporter_id || JSON.stringify(supportPermissionDrafts[item.supporter_id] || item.permissions) === JSON.stringify(item.permissions)} onClick={() => saveSupportPermissions(item)}>권한 저장</button></li>)}</ul> : <p className="muted">연결된 보호자나 담당자가 없습니다.</p>}<form className="privacy-connect" onSubmit={addPrivacyCaregiver}><label>보호자·담당자 아이디<input required maxLength="64" value={caregiverUsername} onChange={event => setCaregiverUsername(event.target.value)} /></label><fieldset><legend>부여할 권한</legend><div className="permission-options">{Object.entries(SUPPORT_PERMISSION_LABELS).map(([permission, label]) => <label key={permission}><input type="checkbox" checked={newSupportPermissions.includes(permission)} onChange={() => setNewSupportPermissions(current => toggleSupportPermission(current, permission))} />{label}</label>)}</div></fieldset><button className="primary" disabled={privacyBusy === 'caregiver' || !newSupportPermissions.length}>연결</button></form></article>
        <article><h3>연결 변경 이력</h3>{privacyAudit.length ? <ul className="privacy-audit">{privacyAudit.slice(0, 10).map(item => <li key={item.id}><span>{({ caregiver_connected: '보호자 연결', caregiver_disconnected: '보호자 연결 해제', support_granted: '지원 연결 및 권한 부여', support_permissions_changed: '지원 권한 변경', support_revoked: '지원 연결 해제', personal_data_deleted: '이용 데이터 삭제' })[item.action] || item.action}<small>처리자 {item.actor_id}</small></span><time>{new Date(item.created_at).toLocaleString('ko-KR')}</time></li>)}</ul> : <p className="muted">변경 이력이 없습니다.</p>}</article>
        <article className="privacy-data"><h3>다운로드와 삭제</h3><p>다운로드에는 계정 정보, 문장·음성 이력, 개인 카드와 현재 열람자가 포함됩니다. 이미지 원본과 비밀번호는 포함되지 않습니다.</p><div><button disabled={privacyBusy === 'export'} onClick={downloadPrivacyData}>{privacyBusy === 'export' ? '준비 중…' : '내 데이터 다운로드'}</button><button className="danger" disabled={privacyBusy === 'delete'} onClick={deletePrivacyData}>{privacyBusy === 'delete' ? '삭제 중…' : '이용 데이터 삭제'}</button></div><small>삭제하면 개인 카드, 의사소통·음성 기록, 보호자 연결, 프로필 이미지와 사용자 설정이 제거됩니다. 로그인 계정과 삭제 확인 기록은 유지됩니다.</small></article>
      </div>
      <DeletionReceipt receipt={privacy.deletion_receipt} />
      {localDeletionStatus && <p role="status">{localDeletionStatus === 'completed' ? '이 기기의 임시 기록 삭제 완료' : '기기 임시 기록 삭제 미완료 · 삭제 요청을 다시 실행해 주세요.'}</p>}
    </section></div> },
    ] : []),
    ...(isSupporter && !isCaregiver ? [{ id: 'support', label: '사용자·운영 설정', content: <section className="my-page-settings">
      <h3>연결 사용자 설정</h3><p>{selectedUser ? `${selectedUser.name}님의 설정으로 이동합니다.` : '지원 홈에서 연결 사용자를 먼저 선택해 주세요.'}</p>
      {canManageCards && <button onClick={() => navigateFromMyPage(() => openSupportSection('card_settings'))}>개인 카드 관리</button>}
      {(canManageQuick || canManageBoard) && <button onClick={() => navigateFromMyPage(() => openSupportSection('board_settings'))}>빠른 표현·카드판</button>}
      {canManageVoice && <button onClick={() => navigateFromMyPage(() => openSupportSection('support_settings'))}>음성·접근 설정</button>}
      {canManageLearning && <button onClick={() => navigateFromMyPage(() => openLearning(selectedUser))}>학습 설정</button>}
      {canManageBoard && <button onClick={() => navigateFromMyPage(() => setTab('rfid'))}><span aria-hidden="true"><UiIcon name="reader" /></span>RFID 카드판</button>}
      {!selectedUser && <button onClick={() => navigateFromMyPage(() => setTab('support_home'))}>지원 홈</button>}
      {(canManageContent || canManageAccounts) && <h3>운영 설정</h3>}
      {canManageContent && <><button onClick={() => navigateFromMyPage(() => setTab('admin'))}>공용 콘텐츠 운영</button>
        <button onClick={() => navigateFromMyPage(() => setTab('rfid_registration'))}><span aria-hidden="true"><UiIcon name="tag" /></span>RFID 칩 등록</button></>}
      {canManageAccounts && <button onClick={() => navigateFromMyPage(() => setTab('account_permissions'))}>운영 권한 관리</button>}
    </section> }] : []),
  ];
  return <AccountSettingsDialog key={user.id} name={user.name} sections={settingsSections}
        variant={isCaregiver ? 'caregiver' : 'default'}
        returnFocus={() => compactSidebar ? sidebarOpenRef.current : accountButtonRef.current}
        notice={profileNotice} error={error} onClose={() => setMyPageOpen(false)} />;
}
