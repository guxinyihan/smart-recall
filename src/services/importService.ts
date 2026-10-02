import type { SmartRecallDB } from '../db/database';
import { createCard } from '../domain/cards/cardFactory';
import {
  contentKey,
  importCardInput,
  previewText,
  type ImportPreview,
} from '../domain/importExport/text';
import { createId } from './identifiers';

export async function previewTextImport(
  database: SmartRecallDB,
  text: string,
  format: 'notes' | 'csv' | 'legacy',
  deckId: string,
): Promise<ImportPreview> {
  const [decks, cards] = await Promise.all([database.decks.toArray(), database.cards.toArray()]);
  return previewText(text, format, deckId, decks, cards);
}

export async function commitTextImport(
  database: SmartRecallDB,
  preview: ImportPreview,
  policy: 'skip' | 'keep',
  now: number,
) {
  return database.transaction('rw', database.decks, database.cards, database.units, async () => {
    const decks = await database.decks.toArray();
    const existing = new Set((await database.cards.toArray()).map(contentKey));
    let created = 0;
    let skipped = 0;
    let decksCreated = 0;
    for (const row of preview.rows) {
      if (!row.input || row.status === 'invalid') continue;
      const input = { ...row.input };
      let deck = decks.find((item) => item.id === input.deckId);
      if (!deck && input.deckName) {
        deck = decks.find((item) => item.name.toLowerCase() === input.deckName!.toLowerCase());
        if (!deck) {
          if (!input.deckName.trim() || input.deckName.length > 120)
            throw new Error('An imported deck name is invalid.');
          deck = {
            id: createId('deck'),
            name: input.deckName.trim(),
            description: '',
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
          };
          await database.decks.add(deck);
          decks.push(deck);
          decksCreated++;
        }
      }
      if (!deck || deck.archivedAt !== null)
        throw new Error('An import destination changed. Preview the import again.');
      input.deckId = deck.id;
      const result = createCard(importCardInput(input, createId('card')), now);
      const key = contentKey(result.card);
      if (policy === 'skip' && existing.has(key)) {
        skipped++;
        continue;
      }
      await database.cards.add(result.card);
      await database.units.bulkAdd(result.units);
      existing.add(key);
      created++;
    }
    return { created, skipped, decksCreated };
  });
}
