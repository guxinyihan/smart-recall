import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartRecallDB, loadSnapshot } from './database';
import { LEGACY_DECK_ID, type LegacyWord } from './migrations';
import { createDeck, deleteDeck, duplicateDeck, updateDeck } from '../services/deckService';
import { deleteCard, saveCard } from '../services/cardService';
import { ensureInitialized, saveSettings } from '../services/settingsService';
import { submitReview } from '../services/reviewService';
import { buildQueue } from '../domain/review/queue';

const NOW = Date.UTC(2026, 8, 24, 12);
const databases: SmartRecallDB[] = [];
function fresh() {
  const database = new SmartRecallDB(`storage-test-${crypto.randomUUID()}`, NOW);
  databases.push(database);
  return database;
}
afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await Dexie.delete(database.name);
    }),
  );
});
async function seeded() {
  const database = fresh();
  await ensureInitialized(database);
  const deck = await createDeck(database, { name: 'Operating Systems' }, NOW);
  const card = await saveCard(
    database,
    { deckId: deck.id, type: 'basic', front: 'fork()', back: 'Creates a process.' },
    NOW,
  );
  const unit = (await database.units.toArray())[0];
  return { database, deck, card, unit };
}

describe('note edits cannot reuse a stale study snapshot', () => {
  it('rejects a basic note changed to cloze and back in the same millisecond', async () => {
    const { database, deck, card, unit } = await seeded();
    await saveCard(
      database,
      { id: card.id, deckId: deck.id, type: 'cloze', text: '{{c1::new answer}}' },
      NOW,
    );
    const edited = await saveCard(
      database,
      {
        id: card.id,
        deckId: deck.id,
        type: 'basic',
        front: 'Changed question',
        back: 'Changed answer',
      },
      NOW,
    );
    expect(edited.revision).toBe(2);
    expect((await database.units.get(unit.id))?.revision).toBe(0);
    await expect(
      submitReview(database, {
        unitId: unit.id,
        expectedRevision: 0,
        expectedCardRevision: 0,
        rating: 'good',
        now: NOW,
      }),
    ).rejects.toThrow('note changed');
    expect(await database.events.count()).toBe(0);
    expect((await database.units.get(unit.id))?.state).toBe('new');
  });

  it('rejects a removed and reintroduced cloze index from an old session', async () => {
    const { database, deck } = await seeded();
    const card = await saveCard(
      database,
      { deckId: deck.id, type: 'cloze', text: '{{c1::one}} and {{c2::two}}' },
      NOW,
    );
    const second = (await database.units.where('cardId').equals(card.id).toArray()).find(
      (unit) => unit.clozeIndex === 2,
    )!;
    await saveCard(
      database,
      { id: card.id, deckId: deck.id, type: 'cloze', text: '{{c1::one}}' },
      NOW,
    );
    await saveCard(
      database,
      { id: card.id, deckId: deck.id, type: 'cloze', text: '{{c1::one}} and {{c2::edited two}}' },
      NOW,
    );
    await expect(
      submitReview(database, {
        unitId: second.id,
        expectedRevision: second.revision,
        expectedCardRevision: card.revision,
        rating: 'good',
        now: NOW,
      }),
    ).rejects.toThrow('note changed');
    expect(await database.events.count()).toBe(0);
  });
});

describe('versioned legacy migration', () => {
  it('opens a fresh schema and upgrades an empty v1 without inventing cards or history', async () => {
    const database = fresh();
    const legacy = new Dexie(database.name);
    legacy.version(1).stores({ words: '++id, word, box, nextReview' });
    await legacy.open();
    legacy.close();
    await ensureInitialized(database);
    expect(database.verno).toBe(2);
    expect(await database.words.count()).toBe(0);
    expect(await database.cards.count()).toBe(0);
    expect(await database.events.count()).toBe(0);
    expect(await database.settings.get('app')).toMatchObject({ dailyNewLimit: 20 });
  });

  it('retains raw records and mixed IDs, text, duplicate-looking notes and valid schedules exactly once', async () => {
    const database = fresh();
    const legacy = new Dexie(database.name);
    legacy.version(1).stores({ words: '++id, word, box, nextReview' });
    const words: LegacyWord[] = [
      {
        id: 1,
        word: ' fork ',
        context: ' process ',
        box: 1,
        nextReview: '2026-09-24',
        lastReviewed: '1970-01-01',
      },
      {
        id: '1',
        word: 'fork',
        context: 'duplicate text, distinct note',
        box: 4,
        nextReview: '2026-09-30',
        lastReviewed: '2026-09-23',
      },
      {
        id: 'suspended',
        word: 'box 6',
        context: 'preserve suspension',
        box: 6,
        nextReview: '9999-12-31',
      },
      {
        id: 7,
        word: 'invalid schedule',
        context: 'data retained',
        box: -8,
        nextReview: 'garbage',
        lastReviewed: null,
        extraField: 'still here',
      },
    ];
    await legacy.table('words').bulkAdd(words);
    legacy.close();
    await ensureInitialized(database);
    expect(await database.words.toArray()).toEqual(expect.arrayContaining(words));
    expect(await database.cards.count()).toBe(4);
    expect(await database.decks.get(LEGACY_DECK_ID)).toMatchObject({ name: 'Imported Vocabulary' });
    expect(await database.cards.get(1)).toMatchObject({
      id: 1,
      front: ' fork ',
      back: ' process ',
    });
    expect(await database.cards.get('1')).toMatchObject({ id: '1' });
    expect(await database.cards.get('suspended')).toMatchObject({ suspended: true });
    const units = await database.units.toArray();
    expect(new Set(units.map((unit) => unit.id)).size).toBe(4);
    expect(units.find((unit) => unit.cardId === '1')).toMatchObject({
      state: 'review',
      interval: 7,
      due: new Date(2026, 8, 30).getTime(),
    });
    expect(units.find((unit) => unit.cardId === 7)).toMatchObject({
      state: 'new',
      due: NOW,
      interval: 0,
    });
    expect(await database.events.count()).toBe(0);
    database.close();
    await database.open();
    expect(await database.cards.count()).toBe(4);
    const snapshot = await loadSnapshot(database);
    const queue = buildQueue({ ...snapshot, now: NOW });
    expect(queue.entries.some((entry) => entry.card.id === 1)).toBe(true);
  });

  it('imports valid localStorage preferences once and rejects malformed legacy values safely', async () => {
    const database = fresh();
    const storage = {
      getItem: vi.fn(
        (key: string) =>
          ({ darkMode: 'true', dailyNewWords: '7', autoShowAnswer: 'true' })[key as 'darkMode'],
      ),
    };
    await ensureInitialized(database, storage);
    expect(await database.settings.get('app')).toMatchObject({
      theme: 'dark',
      dailyNewLimit: 7,
      autoShowAnswer: true,
      legacySettingsMigrated: true,
    });
    const settings = (await database.settings.get('app'))!;
    await saveSettings(database, { ...settings, dailyNewLimit: 3 });
    await ensureInitialized(database, storage);
    expect((await database.settings.get('app'))!.dailyNewLimit).toBe(3);
    expect(storage.getItem).toHaveBeenCalledTimes(3);
    const malformed = fresh();
    await ensureInitialized(malformed, { getItem: () => '{bad json' });
    expect(await malformed.settings.get('app')).toMatchObject({
      theme: 'system',
      dailyNewLimit: 20,
      autoShowAnswer: false,
    });
  });
});

describe('atomic reviews and durable quota accounting', () => {
  it('rolls back the schedule if appending its event fails', async () => {
    const { database, unit } = await seeded();
    database.events.hook('creating', () => {
      throw new Error('Injected storage failure');
    });
    await expect(
      submitReview(database, {
        unitId: unit.id,
        expectedCardRevision: 0,
        expectedRevision: 0,
        rating: 'good',
        now: NOW,
      }),
    ).rejects.toThrow('Injected storage failure');
    expect(await database.units.get(unit.id)).toEqual(unit);
    expect(await database.events.count()).toBe(0);
  });
  it('rejects concurrent and stale reviews, committing just one event', async () => {
    const { database, unit } = await seeded();
    const result = await Promise.allSettled(
      ['again', 'good'].map((rating) =>
        submitReview(database, {
          unitId: unit.id,
          expectedCardRevision: 0,
          expectedRevision: 0,
          rating: rating as 'again' | 'good',
          now: NOW,
        }),
      ),
    );
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(await database.events.count()).toBe(1);
    expect((await database.units.get(unit.id))!.revision).toBe(1);
  });
  it('charges a failed first rating, retains quotas on reopening and permits its learning retry', async () => {
    const { database, deck, unit } = await seeded();
    const settings = (await database.settings.get('app'))!;
    await saveSettings(database, { ...settings, dailyNewLimit: 1, timeZone: 'Asia/Shanghai' });
    const reviewed = await submitReview(database, {
      unitId: unit.id,
      expectedCardRevision: 0,
      expectedRevision: 0,
      rating: 'again',
      now: NOW,
    });
    await saveCard(
      database,
      { deckId: deck.id, type: 'basic', front: 'IPC', back: 'Inter-process communication' },
      NOW,
    );
    database.close();
    await database.open();
    const queue = buildQueue({ ...(await loadSnapshot(database)), now: NOW + 60_000 });
    expect(queue.usage.introducedToday).toBe(1);
    expect(queue.entries).toHaveLength(1);
    expect(queue.entries[0].unit.id).toBe(unit.id);
    await submitReview(database, {
      unitId: unit.id,
      expectedCardRevision: 0,
      expectedRevision: reviewed.unit.revision,
      rating: 'good',
      now: NOW + 60_000,
    });
    const other = (await database.units.toArray()).find((candidate) => candidate.id !== unit.id)!;
    await expect(
      submitReview(database, {
        unitId: other.id,
        expectedCardRevision: 0,
        expectedRevision: 0,
        rating: 'good',
        now: NOW + 60_000,
      }),
    ).rejects.toThrow('limit');
    expect(
      buildQueue({ ...(await loadSnapshot(database)), now: NOW + 86_400_000 }).usage.newRemaining,
    ).toBe(1);
  });
  it('allows reviewing a selected later deck under a one-unit daily quota', async () => {
    const { database } = await seeded();
    const later = await createDeck(database, { name: 'Second deck' }, NOW);
    const card = await saveCard(
      database,
      { deckId: later.id, type: 'basic', front: 'B', back: 'Second' },
      NOW,
    );
    const unit = (await database.units.where('cardId').equals(card.id).toArray())[0];
    await saveSettings(database, { ...(await database.settings.get('app'))!, dailyNewLimit: 1 });
    await expect(
      submitReview(database, {
        unitId: unit.id,
        expectedCardRevision: 0,
        expectedRevision: 0,
        rating: 'good',
        now: NOW,
      }),
    ).resolves.toMatchObject({ event: { cardId: card.id } });
  });
});

describe('deck and note operations', () => {
  it('blocks populated deck deletion, archives safely, duplicates with fresh schedules, and retains history on note deletion', async () => {
    const { database, deck, card, unit } = await seeded();
    await submitReview(database, {
      unitId: unit.id,
      expectedCardRevision: 0,
      expectedRevision: 0,
      rating: 'easy',
      now: NOW,
    });
    await expect(deleteDeck(database, deck.id)).rejects.toThrow('contains cards');
    await updateDeck(database, deck.id, { archived: true }, NOW);
    expect(
      buildQueue({ ...(await loadSnapshot(database)), now: NOW + 86_400_000 * 5 }).entries,
    ).toHaveLength(0);
    const copy = await duplicateDeck(database, deck.id, NOW);
    expect(await database.cards.where('deckId').equals(copy.id).count()).toBe(1);
    expect((await database.units.where('deckId').equals(copy.id).toArray())[0]).toMatchObject({
      state: 'new',
      interval: 0,
      revision: 0,
      introducedAt: null,
    });
    await deleteCard(database, card.id);
    expect(await database.events.count()).toBe(1);
    await deleteDeck(database, deck.id);
    expect(await database.decks.get(deck.id)).toBeUndefined();
  });
});
