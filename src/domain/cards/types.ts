/** Numeric IDs survive the original auto-increment IndexedDB schema unchanged. */
export type CardId = string | number;
export type CardType = 'basic' | 'reverse' | 'cloze';

interface CardFields {
  id: CardId;
  deckId: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  suspended: boolean;
}

export interface BasicCard extends CardFields {
  type: 'basic';
  front: string;
  back: string;
}

export interface ReverseCard extends CardFields {
  type: 'reverse';
  front: string;
  back: string;
}

export interface ClozeCard extends CardFields {
  type: 'cloze';
  text: string;
}

/** A Card is the user's note. Reverse and cloze notes have multiple study units. */
export type Card = BasicCard | ReverseCard | ClozeCard;

export type CardInput = {
  id: CardId;
  deckId: string;
  tags?: string[];
} & (
  | { type: 'basic' | 'reverse'; front: string; back: string }
  | { type: 'cloze'; text: string }
);
