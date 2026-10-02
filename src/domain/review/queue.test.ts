import { describe, expect, it } from 'vitest';
import { createCard } from '../cards/cardFactory';
import type { Card } from '../cards/types';
import type { Deck } from '../decks/types';
import { buildQueue, getDailyUsage, localDayKey } from './queue';
import { createReviewEvent, DAY_MS, scheduleReview } from './scheduler';
import { defaultSettings } from './types';
import type { LearningState, ReviewEvent, SchedulingUnit } from './types';

const now = Date.UTC(2026, 9, 2, 12);
const deck: Deck = {
  id: 'd',
  name: 'OS',
  description: '',
  createdAt: 0,
  updatedAt: 0,
  archivedAt: null,
};
const settings = defaultSettings('UTC');

function note(id: string, state: LearningState = 'new', due = now) {
  const { card, units } = createCard(
    { id, deckId: 'd', type: 'basic', front: id, back: 'Answer' },
    now - 10 * DAY_MS,
  );
  const unit: SchedulingUnit = {
    ...units[0],
    state,
    due,
    introducedAt: state === 'new' ? null : now - 10 * DAY_MS,
  };
  return { card, unit };
}

function queue(
  cards: Card[],
  units: SchedulingUnit[],
  events: ReviewEvent[] = [],
  clock = now,
  overrides = settings,
) {
  return buildQueue({ cards, units, events, now: clock, settings: overrides, decks: [deck] });
}

describe('persisted daily study queue', () => {
  it('defines categories by learning state and local calendar due date', () => {
    const notes = [
      note('new'),
      note('learning', 'learning'),
      note('due', 'review', now - 1000),
      note('overdue', 'review', now - DAY_MS),
      note('future', 'review', now + DAY_MS),
    ];
    const result = queue(
      notes.map((value) => value.card),
      notes.map((value) => value.unit),
    );
    expect(result.entries.map((entry) => entry.category)).toEqual([
      'learning',
      'overdue',
      'due',
      'new',
    ]);
    expect(result.counts).toEqual({ new: 1, learning: 1, due: 1, overdue: 1 });
  });

  it('breaks ties by stable IDs rather than input order', () => {
    const a = note('a');
    const b = note('b');
    expect(queue([b.card, a.card], [b.unit, a.unit]).entries.map((entry) => entry.unit.id)).toEqual(
      queue([a.card, b.card], [a.unit, b.unit]).entries.map((entry) => entry.unit.id),
    );
  });

  it('limits unintroduced units and already introduced units independently', () => {
    const notes = [note('new1'), note('new2'), note('due1', 'review'), note('due2', 'review')];
    const result = queue(
      notes.map((value) => value.card),
      notes.map((value) => value.unit),
      [],
      now,
      { ...settings, dailyNewLimit: 1, dailyReviewLimit: 1 },
    );
    expect(result.entries.map((entry) => entry.card.id)).toEqual(['due1', 'new1']);
  });

  it('treats zero limits as zero, not unlimited', () => {
    const n = note('n');
    const r = note('r', 'review');
    expect(
      queue([n.card, r.card], [n.unit, r.unit], [], now, {
        ...settings,
        dailyNewLimit: 0,
        dailyReviewLimit: 0,
      }).entries,
    ).toEqual([]);
  });

  it('Again introduces a new unit durably and does not free its introduction quota', () => {
    const first = note('a');
    const second = note('b');
    const after = scheduleReview(first.unit, 'again', now);
    const events = [createReviewEvent('e', first.unit, after, 'again', now)];
    const opts = { ...settings, dailyNewLimit: 1, dailyReviewLimit: 0 };
    const beforeRetry = queue([first.card, second.card], [after, second.unit], events, now, opts);
    expect(beforeRetry.entries).toEqual([]);
    expect(beforeRetry.usage).toEqual({
      introducedToday: 1,
      reviewedToday: 0,
      newRemaining: 0,
      reviewRemaining: 0,
    });
    const retry = queue([first.card, second.card], [after, second.unit], events, after.due, opts);
    expect(retry.entries.map((entry) => entry.card.id)).toEqual(['a']);
    // Reloading serialized state does not change the persisted event-based result.
    expect(
      queue(
        JSON.parse(JSON.stringify([first.card, second.card])),
        JSON.parse(JSON.stringify([after, second.unit])),
        JSON.parse(JSON.stringify(events)),
        after.due,
        opts,
      ),
    ).toEqual(retry);
  });

  it('does not consume persisted limits when a review transaction did not commit', () => {
    const first = note('a');
    const result = queue([first.card], [first.unit], [], now, { ...settings, dailyNewLimit: 1 });
    expect(result.usage.introducedToday).toBe(0);
    expect(result.entries).toHaveLength(1);
  });

  it('charges an existing unit once despite many learning retries and allows its retry', () => {
    const first = note('a', 'review');
    const second = note('b', 'review');
    const after = scheduleReview(first.unit, 'again', now);
    const events = [createReviewEvent('1', first.unit, after, 'again', now)];
    const again = scheduleReview(after, 'again', after.due);
    events.push(createReviewEvent('2', after, again, 'again', after.due));
    const result = queue([first.card, second.card], [again, second.unit], events, again.due, {
      ...settings,
      dailyReviewLimit: 1,
    });
    expect(result.usage.reviewedToday).toBe(1);
    expect(result.entries.map((entry) => entry.card.id)).toEqual(['a']);
  });

  it('resets introduction quota at the configured time zone midnight', () => {
    const timestamp = Date.parse('2026-10-02T15:59:00.000Z');
    const nextDay = Date.parse('2026-10-02T16:01:00.000Z');
    const n = note('n');
    const after = scheduleReview(n.unit, 'again', timestamp);
    const event = createReviewEvent('e', n.unit, after, 'again', timestamp);
    const options = { ...settings, timeZone: 'Asia/Shanghai', dailyNewLimit: 1 };
    expect(getDailyUsage([event], timestamp, options).newRemaining).toBe(0);
    expect(getDailyUsage([event], nextDay, options)).toMatchObject({
      introducedToday: 0,
      newRemaining: 1,
    });
    expect(localDayKey(timestamp, options.timeZone)).toBe('2026-10-02');
    expect(localDayKey(nextDay, options.timeZone)).toBe('2026-10-03');
  });

  it('uses the same calendar day on both sides of a DST repeated hour', () => {
    expect(localDayKey(Date.parse('2026-11-01T05:30:00Z'), 'America/New_York')).toBe('2026-11-01');
    expect(localDayKey(Date.parse('2026-11-01T06:30:00Z'), 'America/New_York')).toBe('2026-11-01');
  });

  it('keeps limits global while selecting one deck', () => {
    const n = note('n');
    const other = note('other');
    const next = scheduleReview(other.unit, 'good', now);
    const event = { ...createReviewEvent('e', other.unit, next, 'good', now), deckId: 'other' };
    const result = buildQueue({
      cards: [n.card],
      units: [n.unit],
      events: [event],
      decks: [deck],
      deckId: deck.id,
      settings: { ...settings, dailyNewLimit: 1 },
      now,
    });
    expect(result.entries).toEqual([]);
  });

  it('excludes suspended notes, archived decks, and dangling units', () => {
    const n = note('n');
    expect(queue([{ ...n.card, suspended: true }], [n.unit]).entries).toEqual([]);
    expect(
      buildQueue({
        cards: [n.card],
        units: [n.unit],
        events: [],
        now,
        settings,
        decks: [{ ...deck, archivedAt: now }],
      }).entries,
    ).toEqual([]);
    expect(queue([], [n.unit]).entries).toEqual([]);
  });

  it('does not consume quota from events after the injected time', () => {
    const n = note('n');
    const next = scheduleReview(n.unit, 'good', now + 1000);
    expect(
      getDailyUsage([createReviewEvent('e', n.unit, next, 'good', now + 1000)], now, settings)
        .introducedToday,
    ).toBe(0);
  });
});
