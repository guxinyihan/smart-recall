import Dexie, { type Table } from 'dexie';
import type { Card, CardId } from '../domain/cards/types';
import type { Deck } from '../domain/decks/types';
import { defaultSettings } from '../domain/review/types';
import type { ApplicationSettings, ReviewEvent, SchedulingUnit } from '../domain/review/types';
import { migrateLegacyWord, migratedDeck, type LegacyWord } from './migrations';

export class SmartRecallDB extends Dexie {
  words!: Table<LegacyWord, CardId>;
  decks!: Table<Deck, string>;
  cards!: Table<Card, CardId>;
  units!: Table<SchedulingUnit, string>;
  events!: Table<ReviewEvent, string>;
  settings!: Table<ApplicationSettings, string>;

  constructor(name = 'flashcardDB', migrationNow = Date.now()) {
    super(name);
    // Never rename or remove this original store: v1 user data remains recoverable.
    this.version(1).stores({ words: '++id, word, box, nextReview' });
    this.version(2)
      .stores({
        words: '++id, word, box, nextReview',
        decks: 'id, name, archivedAt',
        cards: 'id, deckId, type, *tags, updatedAt',
        units: 'id, cardId, deckId, due, state, [deckId+due]',
        events: 'id, unitId, cardId, deckId, timestamp, [deckId+timestamp]',
        settings: 'id',
      })
      .upgrade(async (transaction) => {
        const legacy = await transaction.table<LegacyWord>('words').toArray();
        if (legacy.length) {
          await transaction.table('decks').add(migratedDeck(migrationNow));
          const converted = legacy.map((word) => migrateLegacyWord(word, migrationNow));
          await transaction.table('cards').bulkAdd(converted.map((item) => item.card));
          await transaction.table('units').bulkAdd(converted.flatMap((item) => item.units));
        }
        await transaction.table('settings').add(defaultSettings());
      });
    this.on('populate', (transaction) => transaction.table('settings').add(defaultSettings()));
  }
}

export const db = new SmartRecallDB();

export async function loadSnapshot(database: SmartRecallDB) {
  return database.transaction(
    'r',
    [database.decks, database.cards, database.units, database.events, database.settings],
    async () => {
      const [decks, cards, units, events, settings] = await Promise.all([
        database.decks.toArray(),
        database.cards.toArray(),
        database.units.toArray(),
        database.events.toArray(),
        database.settings.get('app'),
      ]);
      if (!settings)
        throw new Error(
          'Application settings are missing. Restore a valid backup or retry opening the database.',
        );
      return { decks, cards, units, events, settings };
    },
  );
}
