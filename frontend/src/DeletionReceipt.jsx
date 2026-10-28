const NAMES = { recommendation_settings: '추천 설정', recommendation_batches: '추천 근거·노출·선택 기록',
  practice_suggestion_settings: '연습 개인화 설정', practice_suggestion_batches: '연습 제안 묶음',
  practice_suggestion_plans: '준비된 연습', practice_suggestion_feedback: '연습 제안 의견',
  communication_sessions: '저장 문장', tts_events: '음성 재생 기록', offline_events: '선택·발화 활동',
  tts_settings: '음성 설정', accessibility_settings: '접근 설정', board_layouts: '카드판 설정', board_audit_logs: '카드판 변경 이력',
  learning_settings: '학습 설정', learning_attempts: '학습 기록', learning_audit_logs: '학습 설정 이력',
  privacy_audit_logs: '이전 개인정보 변경 이력', caregiver_notes: '지원 메모·수정 이력', caregiver_links: '보호자·담당자 연결',
  card_submissions: '개인 카드', card_audit_logs: '개인 카드 변경 이력' };
export default function DeletionReceipt({ receipt }) {
  if (!receipt) return null;
  return <section className="deletion-receipt" aria-label="이용 데이터 삭제 처리 결과">
    <h3>삭제 처리 결과</h3><p role="status">{receipt.status === 'completed' ? '삭제 완료' : receipt.status === 'failed'
      ? '일부 항목만 삭제되었을 수 있습니다. 삭제 요청을 다시 실행해 주세요.' : '삭제 요청 처리 중'}</p>
    <p>요청 번호: {receipt.id}</p><p>요청 시각: {new Date(receipt.requested_at).toLocaleString('ko-KR')}
      {receipt.finished_at ? ` · 처리 시각: ${new Date(receipt.finished_at).toLocaleString('ko-KR')}` : ''}</p>
    <p>이번 요청에서 확인된 삭제 건수입니다. 재시도 이전에 삭제된 항목은 다시 세지 않습니다.</p>
    <ul>{Object.entries(receipt.counts).map(([name, count]) => <li key={name}>{NAMES[name] || name}: {count}건</li>)}</ul>
    <p>프로필 이미지·설정 제거: {receipt.profile_removed ? '처리됨' : '아직 확인되지 않음'}</p>
    <p>유지되는 항목: {receipt.preserved.join(', ')}</p><p>{receipt.limitations}</p>
  </section>;
}
