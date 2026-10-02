import { createCard, unitId } from '../cards/cardFactory';
import type { Card, CardId } from '../cards/types';
import type { Deck } from '../decks/types';
import type { ApplicationSettings, ReviewEvent, SchedulingUnit } from '../review/types';
import type { LegacyWord } from './types';
import { validateSettings } from '../review/settings';

export interface BackupData {
  format: 'smart-recall-backup';
  schemaVersion: 2;
  appVersion: string;
  exportedAt: number;
  decks: Deck[];
  cards: Card[];
  units: SchedulingUnit[];
  events: ReviewEvent[];
  settings: ApplicationSettings;
  legacyWords: LegacyWord[];
}

function fail(message: string): never {
  throw new Error(`Invalid backup: ${message}`);
}
function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail(`${label} must be an object.`);
}
function text(value: unknown, label: string, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) fail(`${label} must be text.`);
}
function timestamp(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15)
    fail(`${label} must be a valid timestamp.`);
}
function integer(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    fail(`${label} must be a nonnegative whole number.`);
}
function cardId(value: unknown): asserts value is CardId {
  if (typeof value === 'number') integer(value, 'card ID');
  else text(value, 'card ID');
}
function array(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
}
function bool(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') fail(`${label} must be true or false.`);
}
function ease(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 10)
    fail(`${label} must be between 1 and 10.`);
}
const states = ['new', 'learning', 'review', 'relearning'];
function state(value: unknown) {
  if (typeof value !== 'string' || !states.includes(value)) fail('Unknown learning state.');
}
function nullableTimestamp(value: unknown, label: string) {
  if (value !== null) timestamp(value, label);
}

function validateDeck(value: unknown): asserts value is Deck {
  record(value, 'deck');
  text(value.id, 'deck ID');
  text(value.name, 'deck name');
  text(value.description, 'deck description', true);
  timestamp(value.createdAt, 'deck creation date');
  timestamp(value.updatedAt, 'deck update date');
  nullableTimestamp(value.archivedAt, 'deck archive date');
}
function validateCard(value: unknown): asserts value is Card {
  record(value, 'card');
  cardId(value.id);
  text(value.deckId, 'card deck');
  timestamp(value.createdAt, 'card creation date');
  timestamp(value.updatedAt, 'card update date');
  integer(value.revision, 'card revision');
  bool(value.suspended, 'suspended flag');
  array(value.tags, 'tags');
  for (const tag of value.tags) text(tag, 'tag');
  if (
    new Set(value.tags).size !== value.tags.length ||
    value.tags.some((tag) => tag !== (tag as string).trim().toLowerCase())
  )
    fail('Tags must be unique, trimmed lowercase strings.');
  if (value.type === 'cloze') {
    text(value.text, 'cloze text');
    createCard(
      { id: value.id, deckId: value.deckId, type: 'cloze', text: value.text },
      value.createdAt,
    );
  } else if (value.type === 'basic' || value.type === 'reverse') {
    text(value.front, 'front');
    text(value.back, 'back');
  } else fail('Unknown card type.');
}
function validateUnit(value: unknown): asserts value is SchedulingUnit {
  record(value, 'scheduling unit');
  text(value.id, 'unit ID');
  cardId(value.cardId);
  text(value.deckId, 'unit deck');
  state(value.state);
  timestamp(value.due, 'due date');
  integer(value.interval, 'interval');
  ease(value.ease, 'ease');
  if (value.interval > 365000) fail('Scheduling interval exceeds the supported bound.');
  for (const key of ['repetitions', 'lapses', 'revision']) integer(value[key], key);
  nullableTimestamp(value.introducedAt, 'introduction date');
  nullableTimestamp(value.lastReviewedAt, 'last review date');
  if (
    typeof value.direction !== 'string' ||
    !['forward', 'reverse', 'cloze'].includes(value.direction)
  )
    fail('Unknown review direction.');
  if (value.direction === 'cloze') {
    integer(value.clozeIndex, 'cloze index');
    if (value.clozeIndex === 0) fail('Cloze index starts at 1.');
  } else if (value.clozeIndex !== undefined) fail('A non-cloze unit has a cloze index.');
  if (
    value.state === 'new' &&
    (value.introducedAt !== null || value.lastReviewedAt !== null || value.interval !== 0)
  )
    fail('A new unit contains review scheduling.');
  if (value.state !== 'new' && value.introducedAt === null)
    fail('A reviewed unit has no introduction date.');
  if (
    typeof value.introducedAt === 'number' &&
    typeof value.lastReviewedAt === 'number' &&
    value.introducedAt > value.lastReviewedAt
  )
    fail('Introduction date occurs after the last review.');
}
function validateEvent(value: unknown): asserts value is ReviewEvent {
  record(value, 'review event');
  text(value.id, 'event ID');
  text(value.unitId, 'event unit');
  cardId(value.cardId);
  text(value.deckId, 'event deck');
  timestamp(value.timestamp, 'review timestamp');
  state(value.previousState);
  state(value.nextState);
  if (typeof value.rating !== 'string' || !['again', 'hard', 'good', 'easy'].includes(value.rating))
    fail('Unknown rating.');
  integer(value.previousInterval, 'previous interval');
  integer(value.nextInterval, 'next interval');
  ease(value.previousEase, 'previous ease');
  ease(value.nextEase, 'next ease');
  timestamp(value.previousDue, 'previous due');
  timestamp(value.nextDue, 'next due');
  bool(value.introduced, 'introduction flag');
  timestamp(value.durationMs, 'review duration');
}
function uniqueIds<T extends { id: CardId }>(items: T[], label: string) {
  const keys = items.map((item) => `${typeof item.id}:${item.id}`);
  if (new Set(keys).size !== keys.length) fail(`Duplicate ${label} IDs.`);
}

export function validateBackup(value: unknown): BackupData {
  record(value, 'root');
  if (value.format !== 'smart-recall-backup' || value.schemaVersion !== 2)
    fail('Unsupported format or schema version.');
  text(value.appVersion, 'application version');
  timestamp(value.exportedAt, 'export date');
  for (const key of ['decks', 'cards', 'units', 'events', 'legacyWords']) array(value[key], key);
  const decks = value.decks as unknown[];
  decks.forEach(validateDeck);
  const cards = value.cards as unknown[];
  cards.forEach(validateCard);
  const units = value.units as unknown[];
  units.forEach(validateUnit);
  const events = value.events as unknown[];
  events.forEach(validateEvent);
  const legacyWords = value.legacyWords as unknown[];
  legacyWords.forEach((word) => {
    record(word, 'legacy word');
    cardId(word.id);
  });
  record(value.settings, 'settings');
  const setting = value.settings;
  text(setting.timeZone, 'time zone');
  bool(setting.showShortcutHints, 'shortcut hints');
  bool(setting.autoShowAnswer, 'answer preference');
  bool(setting.legacySettingsMigrated, 'legacy settings marker');
  record(setting.scheduler, 'scheduler settings');
  for (const key of [
    'initialEase',
    'minEase',
    'maxEase',
    'hardMultiplier',
    'easyBonus',
    'againDelayMinutes',
    'hardDelayMinutes',
    'maxIntervalDays',
  ]) {
    const parameter = setting.scheduler[key];
    if (typeof parameter !== 'number' || !Number.isFinite(parameter) || parameter <= 0)
      fail(`Invalid scheduler ${key}.`);
  }
  const scheduler = setting.scheduler;
  if (
    Number(scheduler.minEase) < 1 ||
    Number(scheduler.maxEase) > 10 ||
    Number(scheduler.minEase) > Number(scheduler.initialEase) ||
    Number(scheduler.initialEase) > Number(scheduler.maxEase) ||
    Number(scheduler.hardMultiplier) < 1 ||
    Number(scheduler.easyBonus) < 1 ||
    !Number.isSafeInteger(scheduler.maxIntervalDays) ||
    Number(scheduler.maxIntervalDays) > 365000
  )
    fail('Invalid scheduler bounds.');
  validateSettings(setting as unknown as ApplicationSettings);
  const backup = value as unknown as BackupData;
  uniqueIds(backup.decks, 'deck');
  uniqueIds(backup.cards, 'card');
  uniqueIds(backup.units, 'unit');
  uniqueIds(backup.events, 'event');
  uniqueIds(backup.legacyWords, 'legacy word');
  const deckIds = new Set(backup.decks.map((deck) => deck.id));
  const unitIds = new Set(backup.units.map((unit) => unit.id));
  for (const card of backup.cards) {
    if (!deckIds.has(card.deckId)) fail('A card references an unknown deck.');
    const expected = createCard(card, card.createdAt).units;
    if (expected.some((unit) => !unitIds.has(unit.id)))
      fail('A card is missing a scheduling unit.');
  }
  for (const unit of backup.units) {
    const card = backup.cards.find((card) => card.id === unit.cardId);
    if (!card || card.deckId !== unit.deckId)
      fail('A scheduling unit references an unknown card or mismatched deck.');
    if (
      unit.id !== unitId(unit.cardId, unit.direction, unit.clozeIndex) ||
      !createCard(card, card.createdAt).units.some((expected) => expected.id === unit.id)
    )
      fail('A scheduling unit does not match its card type.');
  }
  // Events may refer to deleted cards/decks; their historical IDs remain valid.
  return backup;
}

export function parseBackup(json: string): BackupData {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('Invalid backup: the file is not valid JSON.');
  }
  return validateBackup(value);
}
