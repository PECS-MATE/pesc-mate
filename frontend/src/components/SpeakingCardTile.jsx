// Keep playback in the direct button gesture for touch/keyboard audio permission.
export default function SpeakingCardTile({ card, renderArt, disabled, compose = true, onAdd, onSpeak }) {
  return <div className="card-tile"><button type="button" className="card speak-on-tap" disabled={disabled}
    aria-label={`${card.label} ${compose ? '문장에 담고 말하기' : '바로 말하기'}`} onClick={() => {
      if (compose && onAdd(card) === false) return;
      onSpeak(card);
    }}>
    {renderArt(card)}<strong>{card.label}</strong>{card.reason && <small>{card.reason}</small>}
  </button></div>;
}
