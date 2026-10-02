import { DEFAULT_SCHEDULER, RATINGS } from './types';
import type { Rating, ReviewEvent, SchedulerSettings, SchedulingUnit } from './types';

export const DAY_MS = 86_400_000;

function assertScheduler(settings: SchedulerSettings): void {
  if (Object.values(settings).some(value => !Number.isFinite(value) || value <= 0) ||
    settings.minEase > settings.initialEase || settings.initialEase > settings.maxEase ||
    settings.minEase < 1 || settings.hardMultiplier < 1 || settings.easyBonus < 1 ||
    !Number.isInteger(settings.maxIntervalDays)) throw new Error('Invalid scheduler settings.');
}

/** A small SM-2-inspired strategy. All time is supplied by the caller. */
export function scheduleReview(
  unit: SchedulingUnit,
  rating: Rating,
  now: number,
  settings: SchedulerSettings = DEFAULT_SCHEDULER,
): SchedulingUnit {
  assertScheduler(settings);
  if (!Number.isFinite(now) || now < 0 || !RATINGS.includes(rating)) throw new Error('Invalid review input.');
  if (![unit.due, unit.interval, unit.ease, unit.repetitions, unit.lapses, unit.revision].every(Number.isFinite) ||
    unit.interval < 0 || unit.repetitions < 0 || unit.lapses < 0 || unit.revision < 0 ||
    (unit.lastReviewedAt !== null && now < unit.lastReviewedAt)) throw new Error('Invalid scheduling state or review time.');
  const clampEase = (ease: number) => Math.round(Math.min(settings.maxEase, Math.max(settings.minEase, ease)) * 100) / 100;
  const days = (interval: number) => Math.min(settings.maxIntervalDays, Math.max(1, Math.round(interval)));
  const next: SchedulingUnit = {
    ...unit, introducedAt: unit.introducedAt ?? now, lastReviewedAt: now,
    revision: unit.revision + 1, ease: clampEase(unit.ease),
  };
  const shortStep = unit.state !== 'review';
  if (rating === 'again') {
    next.state = unit.state === 'review' || unit.state === 'relearning' ? 'relearning' : 'learning';
    next.interval = 0;
    next.due = now + settings.againDelayMinutes * 60_000;
    next.ease = clampEase(unit.ease - 0.2);
    next.repetitions = 0;
    // Only losing a graduated review card starts a lapse, not each learning retry.
    next.lapses = unit.lapses + (unit.state === 'review' ? 1 : 0);
  } else if (rating === 'hard' && shortStep) {
    next.state = unit.state === 'relearning' ? 'relearning' : 'learning';
    next.interval = 0;
    next.due = now + settings.hardDelayMinutes * 60_000;
    next.ease = clampEase(unit.ease - 0.15);
  } else {
    next.state = 'review';
    next.repetitions = shortStep ? 1 : unit.repetitions + 1;
    if (rating === 'hard') {
      next.interval = days(unit.interval * settings.hardMultiplier);
      next.ease = clampEase(unit.ease - 0.15);
    } else if (rating === 'good') {
      next.interval = shortStep ? 1 : unit.repetitions <= 1 ? 6 : days(Math.max(unit.interval + 1, unit.interval * next.ease));
    } else {
      next.interval = shortStep ? 4 : days(Math.max(unit.interval + 1, unit.interval * next.ease * settings.easyBonus));
      next.ease = clampEase(unit.ease + 0.15);
    }
    next.interval = Math.min(settings.maxIntervalDays, next.interval);
    next.due = now + next.interval * DAY_MS;
  }
  return next;
}

export function createReviewEvent(
  id: string, before: SchedulingUnit, after: SchedulingUnit, rating: Rating, now: number, durationMs = 0,
): ReviewEvent {
  if (!id.trim() || before.id !== after.id || after.revision !== before.revision + 1 ||
    after.lastReviewedAt !== now || !Number.isFinite(durationMs) || durationMs < 0) throw new Error('Invalid review event.');
  return Object.freeze({
    id, unitId: before.id, cardId: before.cardId, deckId: before.deckId, timestamp: now, rating,
    previousState: before.state, nextState: after.state,
    previousInterval: before.interval, nextInterval: after.interval,
    previousEase: before.ease, nextEase: after.ease, previousDue: before.due, nextDue: after.due,
    introduced: before.introducedAt === null, durationMs,
  });
}
