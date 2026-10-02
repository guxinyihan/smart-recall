import { createCard, normalizeTags } from '../cards/cardFactory';
import type { Card, CardInput, CardType } from '../cards/types';
import type { Deck } from '../decks/types';

export type ImportedCardInput = Omit<CardInput, 'id'> & {
  type: CardType;
  front?: string;
  back?: string;
  text?: string;
  deckName?: string;
};
export interface ImportRow {
  line: number;
  status: 'valid' | 'duplicate' | 'invalid';
  error?: string;
  input?: ImportedCardInput;
}
export interface ImportPreview {
  format: 'notes' | 'csv' | 'legacy';
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  decksToCreate: string[];
  rows: ImportRow[];
}

export function importCardInput(input: ImportedCardInput, id: string): CardInput {
  const fields = { id, deckId: input.deckId, tags: input.tags };
  return input.type === 'cloze'
    ? { ...fields, type: 'cloze', text: input.text ?? '' }
    : { ...fields, type: input.type, front: input.front ?? '', back: input.back ?? '' };
}

export function contentKey(
  card: Pick<Card, 'type' | 'deckId'> & { front?: string; back?: string; text?: string },
): string {
  return JSON.stringify([
    card.deckId,
    card.type,
    (card.type === 'cloze' ? card.text : card.front)?.trim().toLowerCase(),
    card.type === 'cloze' ? '' : card.back?.trim().toLowerCase(),
  ]);
}

/** Small RFC4180 reader; escaped quotes, CRLF and multiline cells are supported. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closed = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += character;
    } else if (character === '"') {
      if (field || closed) throw new Error('CSV contains a quote inside an unquoted cell.');
      quoted = true;
    } else if (character === ',' || character === '\n' || character === '\r') {
      row.push(field);
      field = '';
      closed = false;
      if (character !== ',') {
        if (row.some((cell) => cell.length)) rows.push(row);
        row = [];
        if (character === '\r' && source[index + 1] === '\n') index++;
      }
    } else {
      if (closed) throw new Error('CSV contains text after a closing quote.');
      field += character;
    }
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted cell.');
  row.push(field);
  if (row.some((cell) => cell.length)) rows.push(row);
  return rows;
}

export function previewText(
  text: string,
  format: 'notes' | 'csv' | 'legacy',
  deckId: string,
  decks: Deck[],
  existing: Card[],
): ImportPreview {
  if (!decks.some((deck) => deck.id === deckId && deck.archivedAt === null))
    throw new Error('Select an active destination deck.');
  const rows: ImportRow[] = [];
  const seen = new Set(existing.map(contentKey));
  const newDecks = new Set<string>();
  function append(line: number, input: ImportedCardInput) {
    try {
      const card = createCard(importCardInput(input, `preview-${line}`), 0).card;
      input.tags = card.tags;
      const key = contentKey(card);
      const duplicate = seen.has(key);
      seen.add(key);
      if (
        input.deckName &&
        !decks.some(
          (deck) => deck.name.trim().toLowerCase() === input.deckName!.trim().toLowerCase(),
        )
      )
        newDecks.add(input.deckName);
      rows.push({ line, status: duplicate ? 'duplicate' : 'valid', input });
    } catch (error) {
      rows.push({
        line,
        status: 'invalid',
        error: error instanceof Error ? error.message : 'Invalid card.',
      });
    }
  }
  if (format === 'notes') {
    text.split(/\r?\n/).forEach((line, index) => {
      if (!line.trim()) return;
      if (line.includes('{{')) {
        append(index + 1, { deckId, type: 'cloze', text: line, tags: [] });
        return;
      }
      const separator = line.includes(' :: ')
        ? ' :: '
        : line.includes(' ? ')
          ? ' ? '
          : line.includes('::')
            ? '::'
            : null;
      if (!separator) {
        rows.push({
          line: index + 1,
          status: 'invalid',
          error: 'Use Term :: Definition, Question ? Answer, or cloze syntax.',
        });
        return;
      }
      const location = line.indexOf(separator);
      append(index + 1, {
        deckId,
        type: 'basic',
        front: line.slice(0, location),
        back: line.slice(location + separator.length),
        tags: [],
      });
    });
  } else if (format === 'legacy') {
    let incoming: unknown;
    try {
      incoming = JSON.parse(text);
    } catch {
      throw new Error('The vocabulary file is not valid JSON.');
    }
    if (!Array.isArray(incoming))
      throw new Error('A vocabulary JSON file must contain an array of word and context records.');
    const validDate = (value: unknown): boolean => {
      if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number(value.slice(0, 4)) < 1970
      )
        return false;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    };
    incoming.forEach((value: unknown, index: number) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        rows.push({
          line: index + 1,
          status: 'invalid',
          error: 'Each vocabulary record must be an object.',
        });
        return;
      }
      const record = value as Record<string, unknown>;
      if (
        typeof record.word !== 'string' ||
        !record.word.trim() ||
        typeof record.context !== 'string' ||
        !record.context.trim()
      ) {
        rows.push({
          line: index + 1,
          status: 'invalid',
          error: 'Word and context must be nonempty text.',
        });
        return;
      }
      if (
        record.box !== undefined &&
        (typeof record.box !== 'number' ||
          !Number.isInteger(record.box) ||
          record.box < 1 ||
          record.box > 6)
      ) {
        rows.push({
          line: index + 1,
          status: 'invalid',
          error: 'Legacy box must be a whole number from 1 to 6.',
        });
        return;
      }
      if (
        ['nextReview', 'lastReviewed'].some(
          (key) => record[key] !== undefined && !validDate(record[key]),
        )
      ) {
        rows.push({
          line: index + 1,
          status: 'invalid',
          error: 'Legacy review dates must be real dates in YYYY-MM-DD format.',
        });
        return;
      }
      append(index + 1, {
        deckId,
        type: 'basic',
        front: record.word,
        back: record.context,
        tags: [],
      });
    });
  } else {
    const csv = parseCsv(text);
    const headers = (csv.shift() ?? []).map((header) => header.trim().toLowerCase());
    if (
      !['type', 'front', 'back'].every((header) => headers.includes(header)) ||
      new Set(headers).size !== headers.length
    ) {
      throw new Error(
        'CSV requires unique type, front and back headers. Optional headers: deck, text, tags.',
      );
    }
    for (const [index, cells] of csv.entries()) {
      if (cells.length !== headers.length) {
        rows.push({
          line: index + 2,
          status: 'invalid',
          error: 'Cell count does not match the CSV header.',
        });
        continue;
      }
      const value = (name: string) => cells[headers.indexOf(name)] ?? '';
      const type = value('type').trim().toLowerCase();
      if (!['basic', 'reverse', 'cloze'].includes(type)) {
        rows.push({ line: index + 2, status: 'invalid', error: 'Unknown card type.' });
        continue;
      }
      const deckName = value('deck').trim();
      const namedDeck = decks.find(
        (deck) => deck.name.trim().toLowerCase() === deckName.toLowerCase(),
      );
      if (namedDeck?.archivedAt !== null && namedDeck !== undefined) {
        rows.push({ line: index + 2, status: 'invalid', error: 'The named deck is archived.' });
        continue;
      }
      const resolvedId =
        namedDeck?.id ?? (deckName ? `import-deck:${deckName.toLowerCase()}` : deckId);
      const tags = normalizeTags(value('tags').split(';'));
      append(index + 2, {
        deckId: resolvedId,
        deckName: deckName || undefined,
        type: type as CardType,
        front: value('front'),
        back: value('back'),
        text: value('text') || value('front'),
        tags,
      });
    }
  }
  return {
    format,
    total: rows.length,
    valid: rows.filter((row) => row.status === 'valid').length,
    invalid: rows.filter((row) => row.status === 'invalid').length,
    duplicates: rows.filter((row) => row.status === 'duplicate').length,
    decksToCreate: [...newDecks],
    rows,
  };
}

export function exportCardsCsv(cards: Card[], decks: Deck[]): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = cards.map((card) => [
    decks.find((deck) => deck.id === card.deckId)?.name ?? card.deckId,
    card.type,
    card.type === 'cloze' ? card.text : card.front,
    card.type === 'cloze' ? '' : card.back,
    card.type === 'cloze' ? card.text : '',
    card.tags.join(';'),
  ]);
  return [['deck', 'type', 'front', 'back', 'text', 'tags'], ...rows]
    .map((row) => row.map(escape).join(','))
    .join('\r\n');
}
