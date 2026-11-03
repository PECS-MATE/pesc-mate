import UiIcon from './UiIcon';

export default function CaregiverHome({ accountId, users, target, offline, onSelect, onOpen, onPractice, gallery, children }) {
  const permissions = target?.permissions || [];
  const allowed = permission => permissions.includes(permission);
  const primary = [
    allowed('cards_manage') && { id: 'card_settings', icon: 'cards', title: '개인 카드 관리', description: '카드를 등록하고 인쇄해요.' },
    allowed('learning_manage') && { id: 'learning_progress', icon: 'book', title: '연습 관리', description: '연습을 준비하고 기록을 확인해요.' },
    allowed('records_read') && { id: 'dashboard', icon: 'chart', title: '기록 보기', description: allowed('notes_write') ? '최근 표현을 보고 메모를 남겨요.' : '아이의 최근 표현을 살펴봐요.' },
  ].filter(Boolean);
  const secondary = [
    allowed('voice_access_manage') && { id: 'support_settings', icon: 'accessibility', title: '아이 음성·화면 설정' },
    (allowed('board_manage') || allowed('quick_speech_manage')) && { id: 'board_settings', icon: 'grid', title: '빠른 표현·카드판 관리' },
    allowed('board_manage') && { id: 'rfid', icon: 'reader', title: 'RFID 리더기 관리' },
  ].filter(Boolean);
  return <section className="caregiver-home" aria-labelledby="caregiver-home-title">
    <header className="caregiver-home-heading"><div><h2 id="caregiver-home-title">{target ? `${target.name}님의 관리` : '아이와 연결해 주세요'}</h2>
      <p>{target ? '필요한 작업을 골라 아이의 소통을 도와주세요.' : '아이 계정에서 보호자를 연결하면 관리할 수 있어요.'}</p></div>
      {!!users.length && <label className="user-picker">아이 선택<select value={target?.id || ''} onChange={event => onSelect(event.target.value)}>
        {users.map(user => <option key={user.id} value={user.id}>{user.name} ({user.username || user.id})</option>)}
      </select></label>}
    </header>
    {gallery}
    {!users.length ? <div className="caregiver-connection-guide"><h3>처음 연결하는 방법</h3><ol>
      <li>아이 계정으로 로그인한 뒤 프로필에서 보호자 설정을 열어 주세요.</li>
      <li>‘보호자·담당자 연결’에 보호자 아이디 <code>{accountId}</code>를 입력해 주세요.</li>
      <li>필요한 관리 권한을 선택해 연결한 뒤 이 화면을 새로고침해 주세요.</li>
    </ol><p>동의와 권한은 아이 계정의 기존 보호자 설정에서 확인해야 해요. 여기서는 자동으로 연결하지 않아요.</p></div> : <>
      <p className="caregiver-home-state" role="status"><UiIcon name={offline ? 'volume-off' : 'check'} />
        {offline ? '오프라인이에요. 온라인 연결 후 관리 내용을 불러와 주세요.' : `${target?.name || '선택한 아이'}님의 관리 화면이에요.`}
        {allowed('records_read') && <span>기록·동의 상태는 기록 보기에서 확인할 수 있어요.</span>}
      </p>
      <h3>자주 쓰는 작업</h3>
      {primary.length ? <div className="caregiver-primary-tasks">{primary.map(task => <button type="button" key={task.id}
        onClick={() => task.id === 'learning_progress' ? onPractice() : onOpen(task.id)}>
        <UiIcon name={task.icon} size={24} /><span><strong>{task.title}</strong><small>{task.description}</small></span><UiIcon name="chevron-right" />
      </button>)}</div> : <p>현재 허용된 주요 관리 기능이 없어요. 아이 계정의 보호자 설정에서 연결 권한을 확인해 주세요.</p>}
      {children}
      {!!secondary.length && <section className="caregiver-secondary-tasks" aria-labelledby="caregiver-other-title"><h3 id="caregiver-other-title">기타 관리</h3>
        <ul>{secondary.map(task => <li key={task.id}><button type="button" onClick={() => onOpen(task.id)}><UiIcon name={task.icon} /><span>{task.title}</span><UiIcon name="chevron-right" /></button></li>)}</ul>
      </section>}
    </>}
  </section>;
}
