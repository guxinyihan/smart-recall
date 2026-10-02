import type { Card } from '../cards/types';
import { localDayKey, queueCategory } from '../review/queue';
import type { Rating, ReviewEvent, SchedulingUnit } from '../review/types';

export interface DailyActivity { day: string; count: number }
export interface DeckActivity {
  deckId: string;
  reviews: number;
  reviewsToday: number;
  lastReviewedAt: number;
}
export interface AnalyticsSummary {
  totalReviews: number;
  reviewsToday: number;
  introducedToday: number;
  ratingDistribution: Record<Rating, number>;
  averageRating: number | null;
  /** All recorded submissions: (Hard + Good + Easy) / all ratings, as a percentage. */
  recallSuccessRate: number | null;
  currentStreak: number;
  totalDurationMs: number;
  averageDurationMs: number | null;
  dailyActivity: DailyActivity[];
  deckActivity: DeckActivity[];
}

/** Move a calendar date, not an elapsed local timestamp: this works across DST. */
export function shiftDayKey(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function calculateAnalytics(
  events: readonly ReviewEvent[], now: number, timeZone: string, windowDays = 30,
): AnalyticsSummary {
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 366) throw new Error('Activity window must be between 1 and 366 days.');
  const today = localDayKey(now, timeZone);
  const historical = events.filter(event => event.timestamp <= now);
  const ratingDistribution: Record<Rating, number> = { again: 0, hard: 0, good: 0, easy: 0 };
  const days = new Map<string, number>();
  const decks = new Map<string, DeckActivity>();
  const introductions = new Set<string>();
  let totalDurationMs = 0;
  let ratingSum = 0;
  const ratingValue: Record<Rating, number> = { again: 1, hard: 2, good: 3, easy: 4 };
  for (const event of historical) {
    const day = localDayKey(event.timestamp, timeZone);
    days.set(day, (days.get(day) || 0) + 1);
    ratingDistribution[event.rating] += 1;
    ratingSum += ratingValue[event.rating];
    totalDurationMs += event.durationMs;
    if (day === today && event.introduced) introductions.add(event.unitId);
    const deck = decks.get(event.deckId) || { deckId: event.deckId, reviews: 0, reviewsToday: 0, lastReviewedAt: 0 };
    deck.reviews += 1;
    if (day === today) deck.reviewsToday += 1;
    deck.lastReviewedAt = Math.max(deck.lastReviewedAt, event.timestamp);
    decks.set(event.deckId, deck);
  }
  // Yesterday keeps a streak alive until there is a chance to study today.
  let streakDay = days.has(today) ? today : shiftDayKey(today, -1);
  let currentStreak = 0;
  while (days.has(streakDay)) {
    currentStreak += 1;
    streakDay = shiftDayKey(streakDay, -1);
  }
  const totalReviews = historical.length;
  return {
    totalReviews, reviewsToday: days.get(today) || 0, introducedToday: introductions.size,
    ratingDistribution, averageRating: totalReviews ? ratingSum / totalReviews : null,
    recallSuccessRate: totalReviews ? (totalReviews - ratingDistribution.again) / totalReviews * 100 : null,
    currentStreak, totalDurationMs, averageDurationMs: totalReviews ? totalDurationMs / totalReviews : null,
    dailyActivity: Array.from({ length: windowDays }, (_, index) => {
      const day = shiftDayKey(today, index - windowDays + 1);
      return { day, count: days.get(day) || 0 };
    }),
    deckActivity: [...decks.values()].sort((a, b) => b.lastReviewedAt - a.lastReviewedAt || a.deckId.localeCompare(b.deckId)),
  };
}

export interface DeckStats {
  totalCards: number;
  totalUnits: number;
  activeUnits: number;
  newUnits: number;
  learningUnits: number;
  dueUnits: number;
  overdueUnits: number;
  reviewsToday: number;
}

/** Note totals and scheduling-unit totals are deliberately different for reverse/cloze. */
export function getDeckStats(
  deckId: string, cards: readonly Card[], units: readonly SchedulingUnit[], events: readonly ReviewEvent[],
  now: number, timeZone: string,
): DeckStats {
  const deckCards = cards.filter(card => card.deckId === deckId);
  const activeCards = new Set(deckCards.filter(card => !card.suspended).map(card => card.id));
  const deckUnits = units.filter(unit => unit.deckId === deckId);
  const activeUnits = deckUnits.filter(unit => activeCards.has(unit.cardId));
  const due = activeUnits.filter(unit => unit.state !== 'new' && unit.due <= now);
  const day = localDayKey(now, timeZone);
  return {
    totalCards: deckCards.length, totalUnits: deckUnits.length, activeUnits: activeUnits.length,
    newUnits: activeUnits.filter(unit => unit.state === 'new').length,
    learningUnits: activeUnits.filter(unit => unit.state === 'learning' || unit.state === 'relearning').length,
    dueUnits: due.length,
    overdueUnits: due.filter(unit => queueCategory(unit, now, timeZone) === 'overdue').length,
    reviewsToday: events.filter(event => event.deckId === deckId && event.timestamp <= now && localDayKey(event.timestamp, timeZone) === day).length,
  };
}
