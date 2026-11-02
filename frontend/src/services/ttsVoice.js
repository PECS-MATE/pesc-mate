export function koreanVoices(voices = []) {
  return voices.filter(voice => /^ko(?:[-_]|$)/i.test(voice.lang || ''));
}

export function localKoreanVoices(voices) {
  return koreanVoices(voices).filter(voice => voice.localService === true);
}

export function selectTtsVoice(voices, preferredName, offline) {
  voices = koreanVoices(voices);
  const preferred = voices.find(voice => voice.name === preferredName);
  const local = localKoreanVoices(voices);
  if (!offline) return preferred || local[0] || voices[0] || null;
  if (preferred?.localService === true) return preferred;
  if (local.length) return local[0];
  if (preferred && preferred.localService !== false) return preferred;
  return null;
}
