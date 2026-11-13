import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import SpeakingCardTile from './SpeakingCardTile';
import { CardArt } from './CardVisuals';

const renderArt = card => <CardArt card={card} />;

it('shows a saved text card once in the center and preserves add and speech actions', () => {
  const card = { id: 'custom:text', label: '기다려 주세요', image_filename: 'text-card.png', image_src: 'blob:synthetic' };
  const onAdd = vi.fn(); const onSpeak = vi.fn();
  const { container } = render(<SpeakingCardTile card={card} renderArt={renderArt} onAdd={onAdd} onSpeak={onSpeak} />);
  expect(screen.getAllByText(card.label)).toHaveLength(1);
  expect(container.querySelector('.text-only-art')).toHaveTextContent(card.label);
  expect(container.querySelector('.card > strong')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: `${card.label} 문장에 담고 말하기` }));
  expect(onAdd).toHaveBeenCalledWith(card);
  expect(onSpeak).toHaveBeenCalledWith(card);
});

it('keeps the image and caption for photo cards', () => {
  const card = { id: 'custom:photo', label: '합성 사진', image_filename: 'photo.png', image_src: 'blob:synthetic' };
  const { container } = render(<SpeakingCardTile card={card} renderArt={renderArt} />);
  expect(container.querySelector('.card-art')).toHaveStyle({ backgroundImage: 'url("blob:synthetic")' });
  expect(container.querySelector('.card > strong')).toHaveTextContent(card.label);
});

it('shows text even when its image is unavailable', () => {
  const card = { id: 'custom:text', label: '잠깐만요', image_filename: 'text-card.png' };
  render(<SpeakingCardTile card={card} renderArt={renderArt} />);
  expect(screen.getAllByText(card.label)).toHaveLength(1);
  expect(screen.queryByText('🖼️')).not.toBeInTheDocument();
});
