import type { Card } from '../cards/types';
import type { Deck } from '../decks/types';
import type { ApplicationSettings, ReviewEvent, SchedulingUnit } from './types';

export type QueueCategory = 'new' | 'learning' | 'due' | 'overdue';
export interface QueueEntry {
  card: Card;
  unit: SchedulingUnit;
  category: QueueCategory;
}
export interface DailyUsage {
  introducedToday: number;
  reviewedToday: number;
  newRemaining: number;
  reviewRemaining: number;
}

// Reusing Intl formatters avoids rebuilding an expensive formatter per historical event.
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

export function localDayKey(timestamp: number, timeZone: string): string {
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 8.64e15)
    throw new Error('Invalid timestamp.');
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dayFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(timestamp);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function todayUnits(events: readonly ReviewEvent[], now: number, timeZone: string) {
  const day = localDayKey(now, timeZone);
  const today = events.filter(
    (event) => event.timestamp <= now && localDayKey(event.timestamp, timeZone) === day,
  );
  const introductions = new Set(
    today.filter((event) => event.introduced).map((event) => event.unitId),
  );
  const reviews = new Set(
    today.filter((event) => !introductions.has(event.unitId)).map((event) => event.unitId),
  );
  return { introductions, reviews };
}

/** Limits count distinct scheduling units globally, not notes or rating-button presses. */
export function getDailyUsage(
  events: readonly ReviewEvent[],
  now: number,
  settings: ApplicationSettings,
): DailyUsage {
  const { introductions, reviews } = todayUnits(events, now, settings.timeZone);
  return {
    introducedToday: introductions.size,
    reviewedToday: reviews.size,
    newRemaining: Math.max(0, settings.dailyNewLimit - introductions.size),
    reviewRemaining: Math.max(0, settings.dailyReviewLimit - reviews.size),
  };
}

export function queueCategory(unit: SchedulingUnit, now: number, timeZone: string): QueueCategory {
  if (unit.state === 'new') return 'new';
  if (unit.state === 'learning' || unit.state === 'relearning') return 'learning';
  return localDayKey(unit.due, timeZone) < localDayKey(now, timeZone) ? 'overdue' : 'due';
}

export interface QueueInput {
  cards: readonly Card[];
  units: readonly SchedulingUnit[];
  decks: readonly Deck[];
  events: readonly ReviewEvent[];
  settings: ApplicationSettings;
  now: number;
  deckId?: string;
}

export function buildQueue({ cards, units, decks, events, settings, now, deckId }: QueueInput): {
  entries: QueueEntry[];
  usage: DailyUsage;
  counts: Record<QueueCategory, number>;
} {
  const usage = getDailyUsage(events, now, settings);
  const today = todayUnits(events, now, settings.timeZone);
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const activeDecks = new Set(
    decks.filter((deck) => deck.archivedAt === null).map((deck) => deck.id),
  );
  const eligible = units.flatMap((unit) => {
    const card = cardsById.get(unit.cardId);
    if (
      !card ||
      card.suspended ||
      card.deckId !== unit.deckId ||
      !activeDecks.has(unit.deckId) ||
      (deckId !== undefined && unit.deckId !== deckId) ||
      unit.due > now
    )
      return [];
    return [{ card, unit, category: queueCategory(unit, now, settings.timeZone) }];
  });
  const priority: Record<QueueCategory, number> = { learning: 0, overdue: 1, due: 2, new: 3 };
  // Stable IDs break all ties; a refresh uses the same persisted state and same order.
  eligible.sort(
    (a, b) =>
      priority[a.category] - priority[b.category] ||
      a.unit.due - b.unit.due ||
      a.card.createdAt - b.card.createdAt ||
      a.unit.id.localeCompare(b.unit.id),
  );
  let newRemaining = usage.newRemaining;
  let reviewRemaining = usage.reviewRemaining;
  const entries = eligible.filter((entry) => {
    if (today.introductions.has(entry.unit.id) || today.reviews.has(entry.unit.id)) return true;
    if (entry.category === 'new') {
      if (!newRemaining) return false;
      newRemaining -= 1;
    } else {
      if (!reviewRemaining) return false;
      reviewRemaining -= 1;
    }
    return true;
  });
  const counts: Record<QueueCategory, number> = { new: 0, learning: 0, due: 0, overdue: 0 };
  for (const entry of eligible) counts[entry.category] += 1;
  return { entries, usage, counts };
}
