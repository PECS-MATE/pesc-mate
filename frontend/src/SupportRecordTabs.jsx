const RECORD_DOMAINS = [
  { id: 'dashboard', label: '의사소통 기록', permission: 'records_read' },
  { id: 'learning_progress', label: '학습 기록', permission: 'learning_manage' },
];

export default function SupportRecordTabs({ active, permissions, onSelect }) {
  const available = RECORD_DOMAINS.filter(item => permissions.includes(item.permission));
  function navigate(event, current) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = available.findIndex(item => item.id === current);
    const next = event.key === 'Home' ? available[0]
      : event.key === 'End' ? available.at(-1)
      : available[(index + (event.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length];
    if (!next || next.id === active) return;
    event.currentTarget.parentElement.querySelector(`#support-record-tab-${next.id}`)?.focus();
    onSelect(next.id);
  }
  return <div className="support-record-navigation">
    <div role="tablist" aria-label="기록 종류">
      {RECORD_DOMAINS.map(item => <button key={item.id} type="button" role="tab"
        id={`support-record-tab-${item.id}`} aria-controls={`support-record-panel-${item.id}`}
        aria-selected={active === item.id} tabIndex={active === item.id ? 0 : -1}
        disabled={!permissions.includes(item.permission)}
        onClick={() => { if (active !== item.id) onSelect(item.id); }}
        onKeyDown={event => navigate(event, item.id)}>
        {item.label}{!permissions.includes(item.permission) && <small>조회 권한 없음</small>}
      </button>)}
    </div>
    <p className="muted">두 기록은 별도 권한으로 조회하며 서로의 지표에 합산하지 않습니다.</p>
    {RECORD_DOMAINS.filter(item => item.id !== active).map(item => <div key={item.id}
      hidden role="tabpanel" id={`support-record-panel-${item.id}`}
      aria-labelledby={`support-record-tab-${item.id}`} />)}
  </div>;
}
