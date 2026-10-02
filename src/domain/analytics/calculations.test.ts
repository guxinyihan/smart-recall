import { describe, expect, it } from 'vitest';
import { createCard } from '../cards/cardFactory';
import { createReviewEvent, DAY_MS, scheduleReview } from '../review/scheduler';
import type { Rating } from '../review/types';
import { calculateAnalytics, getDeckStats } from './calculations';

const now = Date.UTC(2026, 9, 2, 12);
function event(id: string, rating: Rating, timestamp: number, deckId = 'd') {
  const before = createCard({ id, deckId, type: 'basic', front: 'Q', back: 'A' }, timestamp)
    .units[0];
  const after = scheduleReview(before, rating, timestamp);
  return createReviewEvent(id, before, after, rating, timestamp, 2000);
}

describe('event-derived analytics', () => {
  it('has zero activity and undefined ratios for an empty history', () => {
    const result = calculateAnalytics([], now, 'UTC', 7);
    expect(result).toMatchObject({
      totalReviews: 0,
      reviewsToday: 0,
      introducedToday: 0,
      currentStreak: 0,
      averageRating: null,
      recallSuccessRate: null,
      averageDurationMs: null,
      deckActivity: [],
    });
    expect(result.dailyActivity).toHaveLength(7);
    expect(result.dailyActivity.every((day) => day.count === 0)).toBe(true);
  });

  it('counts actual submissions and defines success as non-Again ratings', () => {
    const events = [
      event('1', 'again', now),
      event('2', 'hard', now),
      event('3', 'good', now),
      event('4', 'easy', now),
    ];
    expect(calculateAnalytics(events, now, 'UTC', 1)).toMatchObject({
      totalReviews: 4,
      reviewsToday: 4,
      introducedToday: 4,
      averageRating: 2.5,
      recallSuccessRate: 75,
      ratingDistribution: { again: 1, hard: 1, good: 1, easy: 1 },
      totalDurationMs: 8000,
      averageDurationMs: 2000,
      dailyActivity: [{ day: '2026-10-02', count: 4 }],
    });
  });

  it('counts two retries as two submissions, but only one introduction', () => {
    const before = createCard({ id: 'n', deckId: 'd', type: 'basic', front: 'Q', back: 'A' }, now)
      .units[0];
    const after = scheduleReview(before, 'again', now);
    const next = scheduleReview(after, 'good', after.due);
    const events = [
      createReviewEvent('1', before, after, 'again', now),
      createReviewEvent('2', after, next, 'good', after.due),
    ];
    expect(calculateAnalytics(events, after.due, 'UTC')).toMatchObject({
      totalReviews: 2,
      introducedToday: 1,
      recallSuccessRate: 50,
    });
  });

  it('streak counts unique consecutive dates rather than submissions', () => {
    const events = [
      event('1', 'good', now),
      event('2', 'good', now - 1000),
      event('3', 'again', now - DAY_MS),
      event('4', 'hard', now - 2 * DAY_MS),
      event('5', 'good', now - 4 * DAY_MS),
    ];
    expect(calculateAnalytics(events, now, 'UTC').currentStreak).toBe(3);
  });

  it('keeps yesterday streak available and expires after a missed day', () => {
    const events = [event('1', 'good', now - DAY_MS), event('2', 'good', now - 2 * DAY_MS)];
    expect(calculateAnalytics(events, now, 'UTC').currentStreak).toBe(2);
    expect(calculateAnalytics(events, now + DAY_MS, 'UTC').currentStreak).toBe(0);
  });

  it('counts a calendar streak across DST without using 24-hour offsets', () => {
    const timestamp = Date.parse('2026-11-02T05:30:00Z');
    const events = [
      event('1', 'good', timestamp),
      event('2', 'good', Date.parse('2026-11-01T04:30:00Z')),
      event('3', 'good', Date.parse('2026-10-31T04:30:00Z')),
    ];
    expect(calculateAnalytics(events, timestamp, 'America/New_York').currentStreak).toBe(3);
  });

  it('uses explicit timezone boundaries and excludes future events', () => {
    const timestamp = Date.parse('2026-10-02T16:05:00Z');
    const events = [
      event('1', 'good', timestamp - 600_000),
      event('2', 'again', timestamp),
      event('future', 'easy', timestamp + 60_000),
    ];
    expect(calculateAnalytics(events, timestamp, 'Asia/Shanghai', 2)).toMatchObject({
      totalReviews: 2,
      reviewsToday: 1,
      currentStreak: 2,
      dailyActivity: [
        { day: '2026-10-02', count: 1 },
        { day: '2026-10-03', count: 1 },
      ],
    });
  });

  it('records activity for historical deck IDs without requiring current decks', () => {
    const events = [event('1', 'good', now - DAY_MS, 'deleted'), event('2', 'good', now, 'active')];
    expect(calculateAnalytics(events, now, 'UTC').deckActivity).toEqual([
      { deckId: 'active', reviews: 1, reviewsToday: 1, lastReviewedAt: now },
      { deckId: 'deleted', reviews: 1, reviewsToday: 0, lastReviewedAt: now - DAY_MS },
    ]);
  });

  it('keeps note totals separate from scheduling-unit totals and excludes suspended units', () => {
    const reverse = createCard(
      { id: 'r', deckId: 'd', type: 'reverse', front: 'process', back: '进程' },
      now,
    );
    const suspended = createCard(
      { id: 's', deckId: 'd', type: 'basic', front: 'Q', back: 'A' },
      now,
    );
    expect(
      getDeckStats(
        'd',
        [reverse.card, { ...suspended.card, suspended: true }],
        [...reverse.units, ...suspended.units],
        [],
        now,
        'UTC',
      ),
    ).toMatchObject({
      totalCards: 2,
      totalUnits: 3,
      activeUnits: 2,
      newUnits: 2,
      learningUnits: 0,
      dueUnits: 0,
      overdueUnits: 0,
    });
  });
});
