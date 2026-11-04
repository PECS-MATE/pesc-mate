import { requestBlob } from './api';
import { createCardImageLookup } from './cardImages';

const CARD_IMAGE_MODULES = import.meta.glob('../assets/cards/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

const bundledCardImage = createCardImageLookup(CARD_IMAGE_MODULES);
export const CARD_IMAGE_URLS = Object.values(CARD_IMAGE_MODULES);

export function cardImage(card) {
  return card.image_src || bundledCardImage(card.label);
}

export function artStyle(card) {
  const image = cardImage(card);
  return image ? { backgroundImage: `url(${image})`, backgroundPosition: 'center', backgroundSize: 'cover' } : undefined;
}
export function cacheableCards(items) {
  return items.map(({ image_src: _temporaryUrl, ...item }) => item);
}

export function restoreCachedCards(items = []) {
  return items.map(item => item.image_blob
    ? { ...item, image_src: URL.createObjectURL(item.image_blob) }
    : item);
}

export function cacheableLearningGame(game) {
  const withoutTemporaryUrl = card => {
    const { image_src: _temporaryUrl, ...stored } = card;
    return stored;
  };
  return {
    ...game,
    questions: game.questions.map(question => ({
      ...question,
      target: withoutTemporaryUrl(question.target),
      options: question.options.map(withoutTemporaryUrl),
      ...(question.sequence ? { sequence: question.sequence.map(withoutTemporaryUrl) } : {}),
    })),
  };
}

export function restoreLearningCards(game, availableCards) {
  const byId = new Map(availableCards.map(card => [card.id, card]));
  const restore = card => byId.get(card.id) || (card.image_blob
    ? { ...card, image_src: URL.createObjectURL(card.image_blob) }
    : card);
  return {
    ...game, phase: 'playing', resumed: true,
    questions: game.questions.map(question => ({
      ...question,
      target: restore(question.target), options: question.options.map(restore),
      ...(question.sequence ? { sequence: question.sequence.map(restore) } : {}),
    })),
  };
}

export async function hydrateImages(items) {
  return Promise.all(items.map(async item => {
    if (!item.image_url) return item;
    try {
      const imageBlob = await requestBlob(item.thumbnail_url || item.image_url);
      return { ...item, image_blob: imageBlob, image_src: URL.createObjectURL(imageBlob) };
    } catch {
      return { ...item, image_failed: true };
    }
  }));
}
