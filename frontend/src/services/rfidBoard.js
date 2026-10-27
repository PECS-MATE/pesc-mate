// Physical slots may contain the same concept more than once. Never de-duplicate by card ID.
export function rfidSelection(snapshot, availableCards) {
  if (!snapshot?.online || snapshot.readers?.length !== 3) return null;
  const byId = new Map(availableCards.map(card => [card.id, card]));
  const readers = [...snapshot.readers].sort((a, b) => a.reader_id - b.reader_id);
  if (!readers.every((row, index) => row.reader_id === index + 1 && ['PRESENT', 'EMPTY'].includes(row.status))) return null;
  const result = [];
  for (const row of readers) {
    if (row.status === 'EMPTY') continue;
    const card = byId.get(row.card_id);
    if (!card) return null;
    result.push(card);
  }
  return result;
}

export function rfidFingerprint(snapshot) {
  return JSON.stringify([snapshot?.device?.device_id, snapshot?.session_id,
    snapshot?.readers?.map(row => [row.reader_id, row.status, row.card_id])]);
}
