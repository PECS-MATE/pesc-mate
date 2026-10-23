export function lockedSlotsPreserved(layout, ids) {
  return (layout?.locked_card_ids || []).every(id => {
    const position = layout.slots.find(slot => slot.card_id === id)?.position;
    return Number.isInteger(position) && ids[position - 1] === id;
  });
}

export function movedSlots(ids, index, offset) {
  const next = [...ids];
  [next[index], next[index + offset]] = [next[index + offset], next[index]];
  return next;
}
