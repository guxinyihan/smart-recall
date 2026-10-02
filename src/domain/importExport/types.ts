import type { CardId } from '../cards/types';

/** Original records are retained verbatim even where a field cannot be mapped. */
export interface LegacyWord {
  id: CardId;
  word?: unknown;
  context?: unknown;
  box?: unknown;
  nextReview?: unknown;
  lastReviewed?: unknown;
  createdAt?: unknown;
  [key: string]: unknown;
}
