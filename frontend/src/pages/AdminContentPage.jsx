import { EmptyState } from '../Mascot';
import UiIcon from '../UiIcon';
import PhysicalCardImporter from '../PhysicalCardImporter';
import AdminCardRegistration from '../AdminCardRegistration';
import A4SharingGallery from '../A4SharingGallery';
import { CARD_META } from '../config/appDefaults';
import { CardArt } from '../components/CardVisuals';

// 권한 확인과 API 상태 변경은 App에서 유지하고 이 화면은 표시와 입력만 담당한다.
export default function AdminContentPage({
  user, offline, adminCategories, adminSubmissions, categoryError, categoryBusy,
  categoryEdits, setCategoryEdits, addCategory, saveCategory, reviewDrafts,
  setReviewDrafts, reviewBusy, reviewCard, setAdminSubmissions, refreshAdminCards,
}) {
  return <section className="admin-review">
    <PhysicalCardImporter
      key={`physical-admin-${user.id}`} admin categories={adminCategories}
      existingCards={[...Object.values(CARD_META), ...adminSubmissions]}
      disabled={offline} onSaved={refreshAdminCards}
    />
    <AdminCardRegistration
      key={`admin-cards-${user.id}`} categories={adminCategories} disabled={offline}
      onCreated={saved => setAdminSubmissions(current => [saved, ...current])}
    />
    <A4SharingGallery
      key={`a4-review-${user.id}`} accountId={user.id} canReview disabled={offline}
    />
    <div className="category-admin">
      <div className="panel-heading">
        <span aria-hidden="true"><UiIcon name="grid" /></span>
        <div><h2>카테고리 관리</h2><p className="muted">카테고리를 추가하고 표시 순서와 활성 상태를 관리하세요.</p></div>
      </div>
      {categoryError && <div role="alert" className="error">{categoryError}</div>}
      <form className="category-create" onSubmit={addCategory}>
        <label>이름<input name="name" required maxLength="30" placeholder="예: 운동" /></label>
        <label>표시 순서<input name="display_order" required type="number" min="1" max="999" defaultValue={adminCategories.length + 1} /></label>
        <button className="primary" disabled={categoryBusy === 'new'}>
          {categoryBusy === 'new' ? '추가 중…' : '카테고리 추가'}
        </button>
      </form>
      <div className="category-admin-list">
        {adminCategories.map(item => <article className={!item.active ? 'inactive' : ''} key={item.id}>
          <label>이름<input
            value={categoryEdits[item.id]?.name ?? item.name} maxLength="30"
            onChange={event => setCategoryEdits(current => ({
              ...current, [item.id]: { ...(current[item.id] || item), name: event.target.value },
            }))}
          /></label>
          <label>순서<input
            type="number" min="1" max="999"
            value={categoryEdits[item.id]?.display_order ?? item.display_order}
            onChange={event => setCategoryEdits(current => ({
              ...current, [item.id]: { ...(current[item.id] || item), display_order: event.target.value },
            }))}
          /></label>
          <b className={`submission-status ${item.active ? 'approved' : 'inactive'}`}>
            {item.active ? '활성' : '비활성'}
          </b>
          <div>
            <button disabled={categoryBusy === item.id} onClick={() => saveCategory(item)}>수정 저장</button>
            <button
              className={item.active ? 'danger' : 'primary'} disabled={categoryBusy === item.id}
              onClick={() => saveCategory(item, !item.active)}
            >{item.active ? '비활성' : '활성화'}</button>
          </div>
        </article>)}
      </div>
    </div>
    <div className="panel-heading">
      <span aria-hidden="true"><UiIcon name="shield" /></span>
      <div><h2>카드 승인 관리</h2><p className="muted">사용자가 제출한 카드를 확인하고 승인하거나 반려해 주세요.</p></div>
    </div>
    <div className="review-summary">
      <strong>{adminSubmissions.filter(item => item.status === 'pending').length}</strong><span>승인 대기</span>
      <strong>{adminSubmissions.filter(item => item.status === 'approved').length}</strong><span>승인 완료</span>
      <strong>{adminSubmissions.filter(item => item.status === 'rejected').length}</strong><span>반려</span>
    </div>
    <div className="review-grid">
      {adminSubmissions.map(item => <article className="review-card" key={item.id}>
        <CardArt card={item} className="review-image" />
        <div className="review-content">
          <div className="review-title">
            <span>
              <small>{item.category} · {item.visibility === 'private' ? '개인 카드' : '공개 카드'}</small>
              <h3>{item.label}</h3>
            </span>
            <b className={`submission-status ${item.status}`}>
              {({ pending: '승인 대기', approved: '승인', rejected: '반려', inactive: '비활성' })[item.status] || item.status}
            </b>
          </div>
          <p>{item.meaning}</p>
          <small>제출자 {item.owner_id} · {new Date(item.created_at).toLocaleString('ko-KR')}</small>
          {item.language_flags?.length > 0 && <div className="language-review">
            <strong>표현 검토 참고</strong>
            {item.language_flags.map(flag => <div key={`${flag.term}-${flag.kind}`}>
              <b>{flag.term}</b><span>{flag.kind} · {flag.meaning}</span><small>{flag.source}</small>
            </div>)}
          </div>}
          {item.image_safety && <div className={`image-safety ${item.image_safety.status}`}>
            <strong>{item.image_safety.status === 'passed' ? '자동 안전성 검사 통과' : '이미지 수동 검토 필요'}</strong>
            <span>{item.image_safety.provider}</span>
            {item.image_safety.reasons?.map(reason => <small key={reason}>{reason}</small>)}
          </div>}
          {item.status === 'pending' ? <>
            <textarea
              aria-label={`${item.label} 검토 사유`} maxLength="500"
              placeholder="반려 시 사유를 입력해 주세요." value={reviewDrafts[item.id] || ''}
              onChange={event => setReviewDrafts(current => ({ ...current, [item.id]: event.target.value }))}
            />
            <div className="review-actions">
              <button className="primary" disabled={reviewBusy === item.id} onClick={() => reviewCard(item, 'approved')}>승인</button>
              <button className="danger" disabled={reviewBusy === item.id} onClick={() => reviewCard(item, 'rejected')}>반려</button>
            </div>
          </> : <>
            {item.review_reason && <p className="review-reason">처리 사유: {item.review_reason}</p>}
            {item.status === 'approved' && <div className="review-actions">
              <button className="danger" disabled={reviewBusy === item.id} onClick={() => reviewCard(item, 'inactive')}>비활성</button>
            </div>}
            {item.status === 'inactive' && <div className="review-actions">
              <button className="primary" disabled={reviewBusy === item.id} onClick={() => reviewCard(item, 'approved')}>재활성</button>
            </div>}
          </>}
        </div>
      </article>)}
    </div>
    {!adminSubmissions.length && <EmptyState>아직 제출된 카드가 없습니다.</EmptyState>}
  </section>;
}
