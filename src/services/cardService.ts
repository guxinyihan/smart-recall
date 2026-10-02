import type { SmartRecallDB } from '../db/database';
import { createCard } from '../domain/cards/cardFactory';
import type { Card, CardId } from '../domain/cards/types';
import { createId } from './identifiers';

export interface CardInput {
  id?: CardId;
  deckId: string;
  type: 'basic' | 'reverse' | 'cloze';
  front?: string;
  back?: string;
  text?: string;
  tags?: string[];
}

export async function saveCard(
  database: SmartRecallDB,
  input: CardInput,
  now: number,
): Promise<Card> {
  return database.transaction('rw', database.decks, database.cards, database.units, async () => {
    const deck = await database.decks.get(input.deckId);
    if (!deck || deck.archivedAt !== null) throw new Error('Choose an active deck.');
    const existing = input.id === undefined ? undefined : await database.cards.get(input.id);
    if (input.id !== undefined && !existing) throw new Error('This card no longer exists.');
    const fields = { id: input.id ?? createId('card'), deckId: input.deckId, tags: input.tags };
    const generated = createCard(
      input.type === 'cloze'
        ? { ...fields, type: 'cloze', text: input.text ?? '' }
        : { ...fields, type: input.type, front: input.front ?? '', back: input.back ?? '' },
      now,
    );
    const card = existing
      ? {
          ...generated.card,
          createdAt: existing.createdAt,
          suspended: existing.suspended,
          revision: existing.revision + 1,
        }
      : generated.card;
    const previousUnits = existing
      ? await database.units.where('cardId').equals(existing.id).toArray()
      : [];
    const units = generated.units.map((unit) => {
      const previous = previousUnits.find((candidate) => candidate.id === unit.id);
      return previous
        ? { ...previous, deckId: card.deckId, revision: previous.revision + 1 }
        : unit;
    });
    await database.cards.put(card);
    await database.units.where('cardId').equals(card.id).delete();
    await database.units.bulkAdd(units);
    return card;
  });
}

export async function deleteCard(database: SmartRecallDB, id: CardId): Promise<void> {
  await database.transaction('rw', database.cards, database.units, async () => {
    await database.cards.delete(id);
    await database.units.where('cardId').equals(id).delete();
    // Review events deliberately outlive deletion of their source note.
  });
}

export async function setCardSuspended(
  database: SmartRecallDB,
  id: CardId,
  suspended: boolean,
  now: number,
): Promise<void> {
  await database.transaction('rw', database.cards, async () => {
    const card = await database.cards.get(id);
    if (!card) throw new Error('This card no longer exists.');
    await database.cards.put({ ...card, suspended, updatedAt: now, revision: card.revision + 1 });
  });
}
