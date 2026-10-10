export function localKoreanVoices(voices) {
  return voices.filter(voice => voice.localService === true);
}

export function selectTtsVoice(voices, preferredName, offline) {
  const preferred = voices.find(voice => voice.name === preferredName);
  const local = localKoreanVoices(voices);
  if (!offline) return preferred || local[0] || voices[0] || null;
  if (preferred?.localService === true) return preferred;
  if (local.length) return local[0];
  if (preferred && preferred.localService !== false) return preferred;
  return null;
}
