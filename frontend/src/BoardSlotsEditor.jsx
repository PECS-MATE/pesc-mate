import { lockedSlotsPreserved } from './services/boardLocks';
import CardArrangementEditor from './CardArrangementEditor';

export default function BoardSlotsEditor({ layout, value, onChange, onSave, busy, renderPicture,
  label = '고정 카드 슬롯 편집', title = '기본 카드판', saveLabel = '카드판 저장', saveDisabled = false }) {
  return <div aria-label={label}><CardArrangementEditor title={title} cards={layout.available_cards || []}
    value={value} onChange={onChange} onSave={onSave} busy={busy} renderPicture={renderPicture}
    lockedIds={layout.locked_card_ids || []} saveLabel={saveLabel} saveDisabled={saveDisabled} isAllowed={ids => lockedSlotsPreserved(layout, ids)} />
  </div>;
}
