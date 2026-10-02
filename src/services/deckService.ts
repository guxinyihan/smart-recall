import type { SmartRecallDB } from '../db/database';
import type { Deck } from '../domain/decks/types';
import { createCard } from '../domain/cards/cardFactory';
import { createId } from './identifiers';

function cleanName(name: string): string {
  if (!name.trim() || name.trim().length > 120)
    throw new Error('Deck name must contain 1–120 characters.');
  return name.trim();
}

export async function createDeck(
  database: SmartRecallDB,
  input: { name: string; description?: string },
  now: number,
): Promise<Deck> {
  const deck: Deck = {
    id: createId('deck'),
    name: cleanName(input.name),
    description: input.description?.trim() ?? '',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  await database.decks.add(deck);
  return deck;
}

export async function updateDeck(
  database: SmartRecallDB,
  id: string,
  input: { name?: string; description?: string; archived?: boolean },
  now: number,
): Promise<void> {
  await database.transaction('rw', database.decks, async () => {
    const deck = await database.decks.get(id);
    if (!deck) throw new Error('This deck no longer exists.');
    await database.decks.put({
      ...deck,
      name: input.name === undefined ? deck.name : cleanName(input.name),
      description: input.description === undefined ? deck.description : input.description.trim(),
      archivedAt: input.archived === undefined ? deck.archivedAt : input.archived ? now : null,
      updatedAt: now,
    });
  });
}

export async function deleteDeck(database: SmartRecallDB, id: string): Promise<void> {
  await database.transaction('rw', database.decks, database.cards, async () => {
    if (await database.cards.where('deckId').equals(id).count())
      throw new Error(
        'This deck contains cards. Archive it, or remove its cards before deleting it.',
      );
    await database.decks.delete(id);
  });
}

export async function duplicateDeck(
  database: SmartRecallDB,
  id: string,
  now: number,
): Promise<Deck> {
  return database.transaction('rw', database.decks, database.cards, database.units, async () => {
    const original = await database.decks.get(id);
    if (!original) throw new Error('This deck no longer exists.');
    const deck: Deck = {
      ...original,
      id: createId('deck'),
      name: `${original.name.slice(0, 113)} (copy)`,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    await database.decks.add(deck);
    for (const card of await database.cards.where('deckId').equals(id).toArray()) {
      const copied = createCard({ ...card, id: createId('card'), deckId: deck.id }, now);
      await database.cards.add(copied.card);
      await database.units.bulkAdd(copied.units);
    }
    return deck;
  });
}
