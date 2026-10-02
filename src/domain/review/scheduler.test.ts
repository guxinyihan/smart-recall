import { describe, expect, it } from 'vitest';
import { createCard } from '../cards/cardFactory';
import { createReviewEvent, DAY_MS, scheduleReview } from './scheduler';
import { DEFAULT_SCHEDULER } from './types';
import type { SchedulingUnit } from './types';

const now = Date.UTC(2026, 9, 2, 8);
const fresh = () =>
  createCard({ id: 'n', deckId: 'd', type: 'basic', front: 'Q', back: 'A' }, now).units[0];
const mature = (): SchedulingUnit => ({
  ...fresh(),
  state: 'review',
  interval: 10,
  repetitions: 3,
  introducedAt: now - DAY_MS * 30,
  lastReviewedAt: now - DAY_MS * 10,
});

describe('SM-2-inspired scheduler', () => {
  it('graduates a first Good rating for one day using the injected clock', () => {
    const unit = fresh();
    const next = scheduleReview(unit, 'good', now);
    expect(next).toMatchObject({
      state: 'review',
      interval: 1,
      due: now + DAY_MS,
      repetitions: 1,
      introducedAt: now,
      revision: 1,
      lastReviewedAt: now,
    });
    expect(unit).toEqual(fresh());
    expect(scheduleReview(unit, 'good', now)).toEqual(next);
  });

  it('records an introduction even on Again, then retries after a minute', () => {
    const next = scheduleReview(fresh(), 'again', now);
    expect(next).toMatchObject({
      state: 'learning',
      interval: 0,
      due: now + 60_000,
      introducedAt: now,
      repetitions: 0,
      lapses: 0,
      ease: 2.3,
    });
  });

  it('uses a five-minute first Hard step, not a false successful graduation', () => {
    expect(scheduleReview(fresh(), 'hard', now)).toMatchObject({
      state: 'learning',
      interval: 0,
      due: now + 300_000,
      introducedAt: now,
      ease: 2.35,
    });
  });

  it('graduates first Easy for four days and raises ease', () => {
    expect(scheduleReview(fresh(), 'easy', now)).toMatchObject({
      state: 'review',
      interval: 4,
      due: now + 4 * DAY_MS,
      ease: 2.65,
      repetitions: 1,
    });
  });

  it('uses the documented Good intervals 1, 6, then interval × ease', () => {
    const first = scheduleReview(fresh(), 'good', now);
    const second = scheduleReview(first, 'good', first.due);
    const third = scheduleReview(second, 'good', second.due);
    expect([first.interval, second.interval, third.interval]).toEqual([1, 6, 15]);
  });

  it('extends a mature Hard interval gently and lowers ease', () => {
    expect(scheduleReview(mature(), 'hard', now)).toMatchObject({
      interval: 12,
      ease: 2.35,
      due: now + DAY_MS * 12,
      repetitions: 4,
      lapses: 0,
    });
  });

  it('gives mature Easy a larger interval than Good', () => {
    expect(scheduleReview(mature(), 'good', now).interval).toBe(25);
    expect(scheduleReview(mature(), 'easy', now).interval).toBe(33);
  });

  it('counts a mature lapse once, preserves its introduction, and regraduates after Good', () => {
    const unit = mature();
    const lapse = scheduleReview(unit, 'again', now);
    const repeat = scheduleReview(lapse, 'again', lapse.due);
    const graduate = scheduleReview(repeat, 'good', repeat.due);
    expect(lapse).toMatchObject({ state: 'relearning', interval: 0, lapses: 1, repetitions: 0 });
    expect(repeat.lapses).toBe(1);
    expect(graduate).toMatchObject({ state: 'review', interval: 1, lapses: 1, repetitions: 1 });
    expect(graduate.introducedAt).toBe(unit.introducedAt);
  });

  it('enforces lower and upper ease bounds after repeated ratings', () => {
    let again = fresh();
    let easy = fresh();
    for (let index = 0; index < 20; index += 1) {
      again = scheduleReview(again, 'again', again.due);
      easy = scheduleReview(easy, 'easy', easy.due);
    }
    expect(again.ease).toBe(DEFAULT_SCHEDULER.minEase);
    expect(easy.ease).toBe(DEFAULT_SCHEDULER.maxEase);
    expect(easy.interval).toBeLessThanOrEqual(DEFAULT_SCHEDULER.maxIntervalDays);
  });

  it('honors a configured maximum interval', () => {
    expect(
      scheduleReview(mature(), 'easy', now, { ...DEFAULT_SCHEDULER, maxIntervalDays: 20 }).interval,
    ).toBe(20);
  });

  it('applies a configured initial ease on the first rating and retains existing ease later', () => {
    const options = { ...DEFAULT_SCHEDULER, initialEase: 2.8 };
    const first = scheduleReview(fresh(), 'good', now, options);
    expect(first.ease).toBe(2.8);
    expect(scheduleReview(first, 'good', first.due, { ...options, initialEase: 2.2 }).ease).toBe(
      2.8,
    );
    expect(scheduleReview(fresh(), 'again', now, options).ease).toBe(2.6);
  });

  it('rejects nonfinite time and a clock moving before the last persisted review', () => {
    expect(() => scheduleReview(fresh(), 'good', NaN)).toThrow();
    const unit = scheduleReview(fresh(), 'good', now);
    expect(() => scheduleReview(unit, 'good', now - 1)).toThrow();
    expect(() => scheduleReview(unit, 'good', now, { ...DEFAULT_SCHEDULER, minEase: 4 })).toThrow();
  });

  it('rejects incoherent introduced state and dates beyond the JavaScript range', () => {
    expect(() => scheduleReview({ ...fresh(), state: 'review' }, 'good', now)).toThrow();
    expect(() => scheduleReview({ ...fresh(), repetitions: 1.5 }, 'good', now)).toThrow();
    expect(() => scheduleReview(fresh(), 'good', 1e100)).toThrow();
    expect(() => scheduleReview({ ...fresh(), due: 8.64e15 }, 'good', 8.64e15)).toThrow();
  });

  it('creates an immutable historical snapshot with first-review quota evidence', () => {
    const before = fresh();
    const after = scheduleReview(before, 'again', now);
    const event = createReviewEvent('e', before, after, 'again', now, 1400);
    expect(event).toMatchObject({
      introduced: true,
      previousState: 'new',
      nextState: 'learning',
      previousInterval: 0,
      nextInterval: 0,
      previousDue: now,
      nextDue: now + 60_000,
      durationMs: 1400,
    });
    expect(Object.isFrozen(event)).toBe(true);
    const second = scheduleReview(after, 'good', after.due);
    expect(createReviewEvent('e2', after, second, 'good', after.due).introduced).toBe(false);
  });
});
