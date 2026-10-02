import type { SmartRecallDB } from '../../db/database';
import { parseBackup, validateBackup, type BackupData } from './validation';

export interface BackupPreview {
  backup: BackupData;
  total: number;
  duplicates: number;
  conflicts: string[];
  decksToCreate: number;
  cardsToCreate: number;
  unitsToCreate: number;
  eventsToCreate: number;
  restoreSettings: boolean;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(source[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export async function exportBackup(database: SmartRecallDB, now: number): Promise<string> {
  return database.transaction(
    'r',
    [
      database.decks,
      database.cards,
      database.units,
      database.events,
      database.settings,
      database.words,
    ],
    async () => {
      const [decks, cards, units, events, settings, legacyWords] = await Promise.all([
        database.decks.toArray(),
        database.cards.toArray(),
        database.units.toArray(),
        database.events.toArray(),
        database.settings.get('app'),
        database.words.toArray(),
      ]);
      return JSON.stringify(
        validateBackup({
          format: 'smart-recall-backup',
          schemaVersion: 2,
          appVersion: '1.0.0',
          exportedAt: now,
          decks,
          cards,
          units,
          events,
          settings,
          legacyWords,
        }),
        null,
        2,
      );
    },
  );
}

async function inspectBackup(database: SmartRecallDB, backup: BackupData): Promise<BackupPreview> {
  const conflicts: string[] = [];
  let duplicates = 0;
  const count = async <T extends { id: string | number }>(
    label: string,
    incoming: T[],
    current: T[],
  ) => {
    let missing = 0;
    for (const item of incoming) {
      const found = current.find((existing) => existing.id === item.id);
      if (!found) missing++;
      else if (stable(found) === stable(item)) duplicates++;
      else
        conflicts.push(
          `${label} ${item.id} has changed. Restore into an empty collection or use another backup.`,
        );
    }
    return missing;
  };
  const [decks, cards, units, events, words] = await Promise.all([
    database.decks.toArray(),
    database.cards.toArray(),
    database.units.toArray(),
    database.events.toArray(),
    database.words.toArray(),
  ]);
  const [decksToCreate, cardsToCreate, unitsToCreate, eventsToCreate] = await Promise.all([
    count('Deck', backup.decks, decks),
    count('Card', backup.cards, cards),
    count('Unit', backup.units, units),
    count('Event', backup.events, events),
    count('Legacy word', backup.legacyWords, words),
  ]);
  return {
    backup,
    conflicts,
    duplicates,
    total: backup.cards.length,
    decksToCreate,
    cardsToCreate,
    unitsToCreate,
    eventsToCreate,
    restoreSettings: decks.length === 0 && cards.length === 0 && events.length === 0,
  };
}

export async function previewBackup(database: SmartRecallDB, json: string): Promise<BackupPreview> {
  return database.transaction(
    'r',
    [database.decks, database.cards, database.units, database.events, database.words],
    () => inspectBackup(database, parseBackup(json)),
  );
}

/** Additive restore only. Conflicting IDs are rejected rather than overwritten. */
export async function mergeBackup(database: SmartRecallDB, preview: BackupPreview): Promise<void> {
  const backup = validateBackup(preview.backup);
  await database.transaction(
    'rw',
    [
      database.decks,
      database.cards,
      database.units,
      database.events,
      database.settings,
      database.words,
    ],
    async () => {
      const checked = await inspectBackup(database, backup);
      if (checked.conflicts.length)
        throw new Error(`Backup restore stopped: ${checked.conflicts[0]}`);
      for (const [table, incoming] of [
        [database.decks, backup.decks],
        [database.cards, backup.cards],
        [database.units, backup.units],
        [database.events, backup.events],
        [database.words, backup.legacyWords],
      ] as const) {
        for (const item of incoming)
          if (!(await table.get(item.id as never))) await table.add(item as never);
      }
      if (preview.restoreSettings && checked.restoreSettings)
        await database.settings.put({ ...backup.settings, legacySettingsMigrated: true });
    },
  );
}
