import type { SmartRecallDB } from '../db/database';
import type { Rating } from '../domain/review/types';
import { scheduleReview, createReviewEvent } from '../domain/review/scheduler';
import { buildQueue } from '../domain/review/queue';
import { createId } from './identifiers';

export async function submitReview(database: SmartRecallDB, input: { unitId: string; expectedRevision: number; rating: Rating; now: number; durationMs?: number }) {
  return database.transaction('rw', [database.units, database.events, database.cards, database.decks, database.settings], async () => {
    const before = await database.units.get(input.unitId);
    if (!before) throw new Error('This review card no longer exists.');
    if (before.revision !== input.expectedRevision) throw new Error('This card changed in another session. Refresh the queue before reviewing it.');
    const [cards, decks, events, settings] = await Promise.all([
      database.cards.toArray(), database.decks.toArray(), database.events.toArray(), database.settings.get('app'),
    ]);
    if (!settings) throw new Error('Application settings are unavailable.');
    const units = await database.units.toArray();
    const queue = buildQueue({ cards, decks, units, events, settings, now: input.now, deckId: before.deckId });
    if (!queue.entries.some(entry => entry.unit.id === before.id)) throw new Error('This card is no longer due or your daily limit has been reached. Refresh the queue.');
    const unit = scheduleReview(before, input.rating, input.now, settings.scheduler);
    const event = createReviewEvent(createId('review'), before, unit, input.rating, input.now, input.durationMs ?? 0);
    await database.units.put(unit);
    await database.events.add(event);
    return { unit, event };
  });
}
