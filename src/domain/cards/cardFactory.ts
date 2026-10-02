import { parseCloze, renderCloze } from './cloze';
import type { Card, CardId, CardInput } from './types';
import { DEFAULT_SCHEDULER } from '../review/types';
import type { SchedulingUnit } from '../review/types';

export function normalizeTags(tags: string[]): string[] {
  if (tags.some(tag => typeof tag !== 'string')) throw new Error('Tags must be text.');
  return [...new Set(tags.map(tag => tag.trim().toLowerCase()).filter(Boolean))].sort();
}

/** A string and a numeric legacy ID cannot collide. */
export function unitId(cardId: CardId, direction: SchedulingUnit['direction'], clozeIndex?: number): string {
  return `${typeof cardId}:${encodeURIComponent(String(cardId))}:${direction}${clozeIndex === undefined ? '' : `:${clozeIndex}`}`;
}

export function createCard(input: CardInput, now: number): { card: Card; units: SchedulingUnit[] } {
  if (!Number.isFinite(now) || now < 0 || now > 8.64e15) throw new Error('Creation time must be a valid timestamp.');
  if (!['basic', 'reverse', 'cloze'].includes(input.type)) throw new Error('Unknown card type.');
  if ((typeof input.id === 'string' && !input.id.trim()) ||
    (typeof input.id === 'number' && (!Number.isSafeInteger(input.id) || input.id < 0))) throw new Error('Invalid card ID.');
  if (!input.deckId.trim()) throw new Error('Select a deck.');
  const fields = { id: input.id, deckId: input.deckId, tags: normalizeTags(input.tags || []),
    createdAt: now, updatedAt: now, suspended: false };
  let card: Card;
  let directions: { direction: SchedulingUnit['direction']; clozeIndex?: number }[];
  if (input.type === 'cloze') {
    const text = input.text.trim();
    const cloze = parseCloze(text);
    if (cloze.errors.length) throw new Error(cloze.errors.join(' '));
    card = { ...fields, type: 'cloze', text };
    directions = cloze.indices.map(clozeIndex => ({ direction: 'cloze', clozeIndex }));
  } else {
    if (!input.front.trim() || !input.back.trim()) throw new Error('Front and back are required.');
    card = { ...fields, type: input.type, front: input.front.trim(), back: input.back.trim() };
    directions = input.type === 'reverse' ? [{ direction: 'forward' }, { direction: 'reverse' }] : [{ direction: 'forward' }];
  }
  const units = directions.map(direction => ({
    id: unitId(input.id, direction.direction, direction.clozeIndex), cardId: card.id, deckId: card.deckId,
    ...direction, state: 'new' as const, due: now, interval: 0, ease: DEFAULT_SCHEDULER.initialEase,
    repetitions: 0, lapses: 0, introducedAt: null, lastReviewedAt: null, revision: 0,
  }));
  return { card, units };
}

/** Returned content is plain text; render it as text nodes, never as HTML. */
export function cardContent(card: Card, unit: SchedulingUnit): { question: string; answer: string } {
  if (card.id !== unit.cardId) throw new Error('Study unit belongs to another card.');
  if (card.type === 'cloze') {
    if (unit.direction !== 'cloze' || unit.clozeIndex === undefined) throw new Error('Cloze unit is missing its index.');
    return { question: renderCloze(card.text, unit.clozeIndex), answer: renderCloze(card.text, unit.clozeIndex, true) };
  }
  if (unit.direction === 'cloze' || (card.type === 'basic' && unit.direction === 'reverse')) throw new Error('Invalid review direction.');
  return unit.direction === 'reverse' ? { question: card.back, answer: card.front } : { question: card.front, answer: card.back };
}
