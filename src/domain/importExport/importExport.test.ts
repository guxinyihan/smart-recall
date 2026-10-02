import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { SmartRecallDB } from '../../db/database';
import { createDeck } from '../../services/deckService';
import { saveCard, deleteCard } from '../../services/cardService';
import { ensureInitialized, saveSettings } from '../../services/settingsService';
import { submitReview } from '../../services/reviewService';
import { previewTextImport, commitTextImport } from '../../services/importService';
import { exportCardsCsv, parseCsv, previewText } from './text';
import { exportBackup, mergeBackup, previewBackup } from './backup';
import { parseBackup } from './validation';

const NOW = Date.UTC(2026, 8, 24, 12);
const databases: SmartRecallDB[] = [];
async function fresh() {
  const database = new SmartRecallDB(`import-test-${crypto.randomUUID()}`, NOW);
  databases.push(database);
  await ensureInitialized(database);
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
async function source() {
  const database = await fresh();
  const deck = await createDeck(database, { name: 'Operating Systems' }, NOW);
  const card = await saveCard(
    database,
    { deckId: deck.id, type: 'reverse', front: 'process', back: '进程', tags: ['os'] },
    NOW,
  );
  await saveCard(
    database,
    {
      deckId: deck.id,
      type: 'cloze',
      text: '{{c1::fork}} creates a {{c2::process}}.',
      tags: ['fork'],
    },
    NOW,
  );
  const unit = (await database.units.where('cardId').equals(card.id).toArray())[0];
  await submitReview(database, {
    unitId: unit.id,
    expectedRevision: 0,
    expectedCardRevision: 0,
    rating: 'again',
    now: NOW,
  });
  await saveSettings(database, {
    ...(await database.settings.get('app'))!,
    dailyNewLimit: 8,
    timeZone: 'Asia/Shanghai',
  });
  return { database, deck, card };
}

describe('deterministic text and CSV import', () => {
  it('previews simple/full vocabulary JSON and imports new Basic notes only after confirmation', async () => {
    const database = await fresh();
    const deck = await createDeck(database, { name: 'Vocabulary' }, NOW);
    const json = JSON.stringify([
      { word: 'fork()', context: 'Creates a process.' },
      {
        word: ' fork() ',
        context: 'Creates a process.',
        box: 2,
        nextReview: '2026-10-01',
        lastReviewed: '2026-09-24',
      },
      {
        id: 'legacy-id',
        word: 'process',
        context: '进程',
        box: 6,
        nextReview: '9999-12-31',
        lastReviewed: '2024-02-29',
      },
    ]);
    const preview = await previewTextImport(database, json, 'legacy', deck.id);
    expect(preview).toMatchObject({
      format: 'legacy',
      total: 3,
      valid: 2,
      duplicates: 1,
      invalid: 0,
    });
    expect(await database.cards.count()).toBe(0);
    expect(await commitTextImport(database, preview, 'skip', NOW)).toMatchObject({
      created: 2,
      skipped: 1,
    });
    expect(
      (await database.cards.toArray()).every(
        (card) => card.type === 'basic' && !card.suspended && card.id !== 'legacy-id',
      ),
    ).toBe(true);
    expect(
      (await database.units.toArray()).every(
        (unit) => unit.state === 'new' && unit.due === NOW && unit.introducedAt === null,
      ),
    ).toBe(true);
    expect(await database.events.count()).toBe(0);
  });

  it('rejects malformed vocabulary JSON and previews invalid field types, boxes and calendar dates', async () => {
    const database = await fresh();
    const deck = await createDeck(database, { name: 'Vocabulary' }, NOW);
    await expect(previewTextImport(database, '{bad', 'legacy', deck.id)).rejects.toThrow(
      'valid JSON',
    );
    await expect(
      previewTextImport(database, '{"word":"a","context":"b"}', 'legacy', deck.id),
    ).rejects.toThrow('array');
    const invalid = [
      null,
      { word: 42, context: 'definition' },
      { word: 'valid', context: [] },
      { word: 'valid', context: 'definition', box: 0 },
      { word: 'valid', context: 'definition', box: 2.5 },
      { word: 'valid', context: 'definition', box: '2' },
      { word: 'valid', context: 'definition', nextReview: '2026-02-29' },
      { word: 'valid', context: 'definition', lastReviewed: '2026-13-01' },
      { word: 'valid', context: 'definition', nextReview: NOW },
    ];
    const preview = await previewTextImport(database, JSON.stringify(invalid), 'legacy', deck.id);
    expect(preview).toMatchObject({ total: invalid.length, valid: 0, invalid: invalid.length });
    expect(await database.cards.count()).toBe(0);
  });
  it('previews valid, invalid and same-batch duplicate notes without writing', async () => {
    const database = await fresh();
    const deck = await createDeck(database, { name: 'Notes' }, NOW);
    const preview = await previewTextImport(
      database,
      'fork() :: Creates a process\nfork() :: Creates a process\nIPC ? Inter-Process Communication\nA {{c1::semaphore}} synchronizes.\nBad notes\n{{c0::invalid}}',
      'notes',
      deck.id,
    );
    expect(preview).toMatchObject({ total: 6, valid: 3, duplicates: 1, invalid: 2 });
    expect(await database.cards.count()).toBe(0);
    expect(await commitTextImport(database, preview, 'skip', NOW)).toMatchObject({
      created: 3,
      skipped: 1,
    });
    expect(await database.cards.count()).toBe(3);
    expect(
      (await previewTextImport(database, 'fork() :: Creates a process', 'notes', deck.id))
        .duplicates,
    ).toBe(1);
    const keep = await previewTextImport(database, 'fork() :: Creates a process', 'notes', deck.id);
    await commitTextImport(database, keep, 'keep', NOW);
    expect(await database.cards.count()).toBe(4);
  });
  it('roundtrips CSV commas, quotes, multiline content, Unicode, reverse/cloze types and tags', async () => {
    const { database, deck } = await source();
    await saveCard(
      database,
      {
        deckId: deck.id,
        type: 'basic',
        front: 'A, "quoted"\nquestion',
        back: '多行\nanswer',
        tags: ['ipc', 'os'],
      },
      NOW,
    );
    const csv = exportCardsCsv(await database.cards.toArray(), await database.decks.toArray());
    const target = await fresh();
    const destination = await createDeck(target, { name: 'Destination' }, NOW);
    const preview = await previewTextImport(target, csv, 'csv', destination.id);
    expect(preview).toMatchObject({
      valid: 3,
      invalid: 0,
      duplicates: 0,
      decksToCreate: ['Operating Systems'],
    });
    expect(await commitTextImport(target, preview, 'skip', NOW)).toMatchObject({
      created: 3,
      decksCreated: 1,
    });
    expect((await target.cards.toArray()).find((card) => card.type === 'basic')).toMatchObject({
      front: 'A, "quoted"\nquestion',
      back: '多行\nanswer',
      tags: ['ipc', 'os'],
    });
    expect(await target.units.count()).toBe(5);
  });
  it('rejects malformed CSV, unknown types, bad row widths and archived destinations', async () => {
    const database = await fresh();
    const deck = await createDeck(database, { name: 'Notes' }, NOW);
    expect(() => parseCsv('"unclosed')).toThrow('unclosed');
    expect(() => parseCsv('bad"quote')).toThrow('quote');
    expect(() => parseCsv('"closed"trailing')).toThrow('closing');
    await expect(previewTextImport(database, 'front,back\na,b', 'csv', deck.id)).rejects.toThrow(
      'type',
    );
    const preview = await previewTextImport(
      database,
      'type,front,back\nweird,a,b\nbasic,too few\ncloze,no markers,',
      'csv',
      deck.id,
    );
    expect(preview.invalid).toBe(3);
    const archived = { ...deck, archivedAt: NOW };
    expect(() => previewText('a :: b', 'notes', deck.id, [archived], [])).toThrow('active');
  });
  it('rolls back the entire import, including newly-created decks, on a failed card write', async () => {
    const database = await fresh();
    const deck = await createDeck(database, { name: 'Destination' }, NOW);
    const preview = await previewTextImport(
      database,
      'deck,type,front,back\nNew deck,basic,a,b\nNew deck,basic,c,d',
      'csv',
      deck.id,
    );
    let calls = 0;
    database.cards.hook('creating', () => {
      if (++calls === 2) throw new Error('Injected import failure');
    });
    await expect(commitTextImport(database, preview, 'skip', NOW)).rejects.toThrow(
      'Injected import failure',
    );
    expect(await database.cards.count()).toBe(0);
    expect(await database.units.count()).toBe(0);
    expect(await database.decks.count()).toBe(1);
  });
});

describe('strict full backups and additive restores', () => {
  it.each(['direction', 'rating'] as const)(
    'rejects array-coerced %s fields before restoring any data',
    async (field) => {
      const { database } = await source();
      const backup = parseBackup(await exportBackup(database, NOW));
      if (field === 'direction') {
        const reverse = backup.units.find((unit) => unit.direction === 'reverse')!;
        Object.assign(reverse, { direction: ['reverse'] });
      } else {
        Object.assign(backup.events[0], { rating: ['again'] });
      }
      const target = await fresh();
      await expect(previewBackup(target, JSON.stringify(backup))).rejects.toThrow('Unknown');
      expect(await target.cards.count()).toBe(0);
      expect(await target.units.count()).toBe(0);
      expect(await target.events.count()).toBe(0);
    },
  );
  it('does not overwrite preferences when a preview promised to keep them but the destination becomes empty', async () => {
    const { database } = await source();
    const target = await fresh();
    const emptyDeck = await createDeck(target, { name: 'Existing empty deck' }, NOW);
    await saveSettings(target, { ...(await target.settings.get('app'))!, dailyNewLimit: 3 });
    const preview = await previewBackup(target, await exportBackup(database, NOW));
    expect(preview.restoreSettings).toBe(false);
    await target.decks.delete(emptyDeck.id);
    await mergeBackup(target, preview);
    expect(await target.settings.get('app')).toMatchObject({ dailyNewLimit: 3 });
    expect(await target.cards.count()).toBe(2);
  });
  it('roundtrips decks, all note types/units, history, settings and legacy raw records without overwriting', async () => {
    const { database } = await source();
    await database.words.add({
      id: 9,
      word: 'raw',
      context: 'preserved',
      box: 'invalid raw value',
    });
    const json = await exportBackup(database, NOW);
    const target = await fresh();
    const preview = await previewBackup(target, json);
    expect(preview).toMatchObject({
      cardsToCreate: 2,
      unitsToCreate: 4,
      eventsToCreate: 1,
      restoreSettings: true,
      conflicts: [],
    });
    expect(await target.cards.count()).toBe(0);
    await mergeBackup(target, preview);
    expect(await target.cards.toArray()).toEqual(await database.cards.toArray());
    expect(await target.units.toArray()).toEqual(await database.units.toArray());
    expect(await target.events.toArray()).toEqual(await database.events.toArray());
    expect(await target.words.get(9)).toMatchObject({ box: 'invalid raw value' });
    expect(await target.settings.get('app')).toMatchObject({
      dailyNewLimit: 8,
      timeZone: 'Asia/Shanghai',
    });
    await mergeBackup(target, await previewBackup(target, json));
    expect(await target.cards.count()).toBe(2);
    expect(await target.events.count()).toBe(1);
  });
  it('preserves review history for deleted notes in a valid restorable backup', async () => {
    const { database, card } = await source();
    await deleteCard(database, card.id);
    const json = await exportBackup(database, NOW);
    expect(parseBackup(json).events).toHaveLength(1);
    const target = await fresh();
    await mergeBackup(target, await previewBackup(target, json));
    expect(await target.events.count()).toBe(1);
  });
  it('rejects schema/type/reference/date/ID/tag/scheduling errors before mutation', async () => {
    const { database } = await source();
    const json = await exportBackup(database, NOW);
    const mutations: ((backup: ReturnType<typeof parseBackup>) => void)[] = [
      (backup) => {
        backup.schemaVersion = 99 as 2;
      },
      (backup) => {
        Object.assign(backup.cards[0], { type: 'unknown' });
      },
      (backup) => {
        backup.cards[0].deckId = 'missing';
      },
      (backup) => {
        backup.cards[0].createdAt = -1;
      },
      (backup) => {
        backup.cards.push(backup.cards[0]);
      },
      (backup) => {
        backup.cards[0].tags = ['OS', 'os'];
      },
      (backup) => {
        Object.assign(backup.cards[0], { tags: 'bad' });
      },
      (backup) => {
        backup.units[0].ease = -2;
      },
      (backup) => {
        backup.units[0].due = Number.NaN;
      },
      (backup) => {
        backup.units[0].cardId = 'missing';
      },
      (backup) => {
        backup.units.pop();
      },
      (backup) => {
        backup.settings.dailyNewLimit = 2.5;
      },
      (backup) => {
        backup.settings.timeZone = 'Not/AZone';
      },
    ];
    const target = await fresh();
    for (const mutation of mutations) {
      const backup = parseBackup(json);
      mutation(backup);
      await expect(previewBackup(target, JSON.stringify(backup))).rejects.toThrow();
    }
    expect(await target.cards.count()).toBe(0);
    expect(await target.events.count()).toBe(0);
  });
  it('detects changed same-ID data and rechecks conflicts when confirming a stale preview', async () => {
    const { database, card } = await source();
    const json = await exportBackup(database, NOW);
    const preview = await previewBackup(database, json);
    await saveCard(
      database,
      { id: card.id, deckId: card.deckId, type: 'reverse', front: 'changed', back: '进程' },
      NOW + 1,
    );
    expect((await previewBackup(database, json)).conflicts.length).toBeGreaterThan(0);
    await expect(mergeBackup(database, preview)).rejects.toThrow('changed');
    expect(await database.cards.get(card.id)).toMatchObject({ front: 'changed' });
  });
  it('rolls back all backup stores when a history write fails and preserves destination settings', async () => {
    const { database } = await source();
    const json = await exportBackup(database, NOW);
    const target = await fresh();
    const before = await target.settings.get('app');
    target.events.hook('creating', () => {
      throw new Error('Injected restore failure');
    });
    await expect(mergeBackup(target, await previewBackup(target, json))).rejects.toThrow(
      'Injected restore failure',
    );
    expect(await target.decks.count()).toBe(0);
    expect(await target.cards.count()).toBe(0);
    expect(await target.units.count()).toBe(0);
    expect(await target.events.count()).toBe(0);
    expect(await target.settings.get('app')).toEqual(before);
  });
});
