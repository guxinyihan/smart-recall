import type { Card } from '../domain/cards/types';
import type { Deck } from '../domain/decks/types';
import type { SchedulingUnit } from '../domain/review/types';
import { createCard } from '../domain/cards/cardFactory';

import type { LegacyWord } from '../domain/importExport/types';
export type { LegacyWord } from '../domain/importExport/types';

export const LEGACY_DECK_ID = 'legacy-imported-vocabulary';

/** Legacy calendar dates were local dates; retain that meaning when upgrading. */
export function legacyDate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15) return value;
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date.getTime() : null;
}

export function migrateLegacyWord(word: LegacyWord, now: number): { card: Card; units: SchedulingUnit[] } {
  const front = typeof word.word === 'string' && word.word.trim() ? word.word : `[Legacy entry ${word.id}]`;
  const back = typeof word.context === 'string' && word.context.trim() ? word.context : '[No definition in legacy record]';
  const createdAt = legacyDate(word.createdAt)
    ?? (typeof word.id === 'string' && /^\d{13}$/.test(word.id) ? Number(word.id) : now);
  const result = createCard({ id: word.id, deckId: LEGACY_DECK_ID, type: 'basic', front, back }, createdAt);
  // createCard trims input for new notes. Migration retains exact original text.
  result.card = { ...result.card, front, back, suspended: word.box === 6 } as Card;
  const box = typeof word.box === 'number' && Number.isInteger(word.box) && word.box >= 1 && word.box <= 6 ? word.box : 1;
  const lastReviewed = legacyDate(word.lastReviewed);
  const reviewed = lastReviewed !== null && lastReviewed > new Date(1970, 0, 1).getTime();
  const intervals = [0, 0, 2, 4, 7, 14, 14];
  result.units = result.units.map(unit => ({ ...unit,
    due: legacyDate(word.nextReview) ?? now,
    interval: intervals[box],
    state: reviewed || box > 1 ? 'review' : 'new',
    repetitions: reviewed || box > 1 ? Math.max(1, box - 1) : 0,
    lastReviewedAt: reviewed ? lastReviewed : null,
    introducedAt: reviewed ? lastReviewed : (box > 1 ? createdAt : null),
  }));
  return result;
}

export function migratedDeck(now: number): Deck {
  return { id: LEGACY_DECK_ID, name: 'Imported Vocabulary', description: 'Vocabulary preserved from the original flashcard application.', createdAt: now, updatedAt: now, archivedAt: null };
}
