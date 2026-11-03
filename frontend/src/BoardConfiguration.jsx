import { useState } from 'react';
import BoardSlotsEditor from './BoardSlotsEditor';
import CardArrangementEditor from './CardArrangementEditor';

export function SettingsDisclosure({ label, children }) {
  const [opened, setOpened] = useState(false);
  return <details className="board-extra-settings" onToggle={event => { if (event.target === event.currentTarget && event.currentTarget.open) setOpened(true); }}>
    <summary>{label}</summary>{opened && children}
  </details>;
}

export default function BoardConfiguration({ layout, canManageQuick, canManageBoard, quick, recovery, slots,
  onQuick, onRecovery, onSlots, onSave, busy, recoveryCards, renderPicture, children }) {
  const modes = [...(canManageQuick ? [['quick', '빠른 표현'], ['recovery', '다시 말하기']] : []), ...(canManageBoard ? [['slots', '기본 카드판']] : [])];
  const [mode, setMode] = useState(modes[0]?.[0]);
  const active = modes.some(([id]) => id === mode) ? mode : modes[0]?.[0];
  return <>
    <div className="arrangement-modes" role="group" aria-label="편집할 카드판">{modes.map(([id, name]) => <button type="button" key={id} aria-pressed={id === active}
      className={id === active ? 'primary' : ''} onClick={() => setMode(id)}>{name}</button>)}</div>
    {active === 'quick' && <CardArrangementEditor key="quick" title="빠른 표현" cards={layout.available_cards || []} value={quick} onChange={onQuick}
      maximum={8} busy={!!busy} renderPicture={renderPicture} onSave={() => onSave('quick')} saveLabel="빠른 표현 저장" />}
    {active === 'recovery' && <CardArrangementEditor key="recovery" title="다시 말하기" cards={recoveryCards} value={recovery} onChange={onRecovery}
      maximum={4} minimum={2} requiredIds={recoveryCards.filter(card => card.fixed).map(card => card.id)} busy={!!busy} renderPicture={renderPicture} onSave={() => onSave('recovery')} saveLabel="복구 표현 저장" />}
    {active === 'slots' && <BoardSlotsEditor layout={layout} value={slots} onChange={onSlots} busy={!!busy} renderPicture={renderPicture} onSave={() => onSave('slots')} />}
    {canManageBoard && children && <SettingsDisclosure label="추가 설정">{children}</SettingsDisclosure>}
  </>;
}
