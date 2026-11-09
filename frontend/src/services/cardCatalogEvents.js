const CHANNEL = 'pecsmate-card-catalog';
const EVENT = 'pecsmate:card-catalog-changed';

// Send only the affected account ID; never send card images, text or tokens.
export function notifyCardCatalogChanged(targetId = null) {
  const detail = { targetId };
  window.dispatchEvent(new CustomEvent(EVENT, { detail }));
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(detail); channel.close();
  } catch { /* Other browsers/devices still refresh on focus and polling. */ }
}

export function observeCardCatalog(accountId, refresh) {
  const receive = detail => {
    if (detail && (detail.targetId === null || detail.targetId === accountId)) refresh();
  };
  const local = event => receive(event.detail);
  window.addEventListener(EVENT, local);
  let channel;
  try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = event => receive(event.data); }
  catch { /* BroadcastChannel is optional. */ }
  return () => { window.removeEventListener(EVENT, local); channel?.close(); };
}
