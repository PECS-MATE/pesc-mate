// Group presentations before network lookup so response latency cannot define tag order.
export const USB_TAG_WINDOW_MS = 150;

export function createUsbTagQueue({
  resolve, onBatch, onError, isCurrent, isEnabled,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  windowMs = USB_TAG_WINDOW_MS, maxPending = 12,
}) {
  let positions = new Map(), pending = null, timer = null, queue = [], running = false, active = null, revision = 0;

  function reset({ forgetPositions = false } = {}) {
    revision += 1;
    if (timer !== null) clearTimer(timer);
    timer = null; pending = null; queue = [];
    if (forgetPositions) positions = new Map();
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const batch = queue.shift(); active = batch;
        const current = () => batch.revision === revision && isCurrent(batch.scope) && isEnabled();
        if (!current()) continue;
        try {
          const results = await resolve(batch.rows);
          if (current()) onBatch(results, batch);
        } catch (error) {
          if (current()) onError(error);
        }
      }
    } finally { active = null; running = false; }
  }

  function flush() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (!pending) return;
    const batch = pending; pending = null;
    // Only different readers constitute a simultaneous placement.
    batch.autoSpeak = new Set(batch.rows.map(row => row.reader_id)).size > 1;
    if (batch.autoSpeak) batch.rows.sort((a, b) => a.reader_id - b.reader_id);
    queue.push(batch);
    void drain();
  }

  function accept(presentation, scope) {
    if (presentation.reset) reset({ forgetPositions: true });
    const rows = presentation.mode === 'positions'
      ? presentation.rows.filter(row => row.uid && positions.get(row.reader_id) !== row.uid)
      : presentation.rows.filter(row => row.uid);
    if (presentation.mode === 'positions') {
      // Observe removals and held cards even while speech/settings block new input.
      positions = new Map(presentation.rows.map(row => [row.reader_id, row.uid]));
    }
    if (!isEnabled()) { reset(); return; }
    if (pending && (!isCurrent(pending.scope) || pending.scope !== scope)) reset();
    for (const row of rows) {
      const at = now();
      if (pending && (at - pending.at >= windowMs || pending.rows.some(item => item.reader_id === row.reader_id))) flush();
      const count = (pending?.rows.length || 0) + queue.reduce((sum, batch) => sum + batch.rows.length, 0)
        + (active?.revision === revision ? active.rows.length : 0);
      if (count >= maxPending) {
        // Reject the whole unsubmitted group rather than speaking a truncated sentence.
        if (timer !== null) clearTimer(timer);
        timer = null; pending = null;
        onError(new Error('queue_full'));
        return;
      }
      if (!pending) {
        pending = { rows: [], scope, at, revision };
        timer = setTimer(flush, windowMs);
      }
      pending.rows.push({ ...row, selected_at: new Date(at).toISOString() });
    }
  }

  return { accept, reset };
}
