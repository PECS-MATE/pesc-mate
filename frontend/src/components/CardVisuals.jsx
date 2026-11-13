import { artStyle, cardImage, isTextOnlyCard } from '../services/cardMedia';

export function CardArt({ card, className = 'card-art' }) {
  if (isTextOnlyCard(card)) return <span className={`${className} text-only-art`} role="img" aria-label={card.label}><span>{card.label}</span></span>;
  const hasImage = Boolean(cardImage(card));
  return <span className={`${className}${hasImage ? '' : ' image-fallback'}`} role="img" aria-label={hasImage ? `${card.label} 그림` : `${card.label} 대체 이미지`} style={hasImage ? artStyle(card) : undefined}>
    {!hasImage && <><b aria-hidden="true">🖼️</b><small>{card.label}</small></>}
  </span>;
}
export function CardPicture({ card, className = 'mini-card' }) {
  const hasImage = Boolean(cardImage(card));
  return <span className={`${className}${hasImage ? '' : ' image-fallback'}`} title={card.label} aria-label={card.label} role="img" style={hasImage ? artStyle(card) : undefined}>{!hasImage && <small>{card.label}</small>}</span>;
}
export function ExpressionVisual({ item }) {
  const hasImage = Boolean(cardImage(item));
  return <span className={`expression-visual${hasImage ? ' has-image' : ''}`} aria-hidden="true" style={hasImage ? artStyle(item) : undefined}>{!hasImage && item.symbol}</span>;
}
