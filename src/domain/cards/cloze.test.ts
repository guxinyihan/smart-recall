import { describe, expect, it } from 'vitest';
import { createCard, cardContent, normalizeTags, unitId } from './cardFactory';
import { parseCloze, renderCloze } from './cloze';

describe('cloze parsing and card directions', () => {
  it('hides the selected answer and reveals a plain-text complete sentence', () => {
    const text = 'fork() creates a {{c1::process}}.';
    expect(parseCloze(text)).toMatchObject({ indices: [1], errors: [] });
    expect(renderCloze(text, 1)).toBe('fork() creates a […].');
    expect(renderCloze(text, 1, true)).toBe('fork() creates a process.');
  });

  it('creates one scheduling unit per unique ID and hides repeated IDs together', () => {
    const text = '{{c2::A}} and {{c1::B::letter}} then {{c2::C}}.';
    expect(parseCloze(text).indices).toEqual([1, 2]);
    expect(renderCloze(text, 2)).toBe('[…] and B then […].');
    expect(renderCloze(text, 1)).toBe('A and [letter] then C.');
    const { card, units } = createCard({ id: 'n', deckId: 'd', type: 'cloze', text }, 100);
    expect(units.map((unit) => unit.clozeIndex)).toEqual([1, 2]);
    expect(cardContent(card, units[1])).toEqual({
      question: '[…] and B then […].',
      answer: 'A and B then C.',
    });
  });

  it.each([
    'ordinary sentence',
    '{{c0::answer}}',
    '{{c-1::answer}}',
    '{{c1::}}',
    '{{c1::   }}',
    '{{c1:answer}}',
    '{{c1::answer}',
    '{{c1::a::b::c}}',
    '{{c1::a {{c2::b}}}}',
    '{{c9007199254740992::answer}}',
  ])('rejects malformed syntax: %s', (text) => {
    expect(parseCloze(text).errors.length).toBeGreaterThan(0);
    expect(() => createCard({ id: 'n', deckId: 'd', type: 'cloze', text }, 100)).toThrow();
  });

  it('preserves ordinary programming braces outside markers', () => {
    expect(renderCloze('if (ready) { return {{c1::true}}; }', 1)).toBe(
      'if (ready) { return […]; }',
    );
  });

  it('rejects rendering a cloze ID that is absent', () => {
    expect(() => renderCloze('{{c1::a}}', 2)).toThrow();
  });

  it('represents reverse content as one note and two separately schedulable units', () => {
    const { card, units } = createCard(
      { id: 42, deckId: 'd', type: 'reverse', front: 'process', back: '进程' },
      100,
    );
    expect(card.id).toBe(42);
    expect(units).toHaveLength(2);
    expect(units[0].cardId).toBe(units[1].cardId);
    expect(cardContent(card, units[0])).toEqual({ question: 'process', answer: '进程' });
    expect(cardContent(card, units[1])).toEqual({ question: '进程', answer: 'process' });
    expect(units[0].id).not.toBe(units[1].id);
    expect(unitId(42, 'forward')).not.toBe(unitId('42', 'forward'));
  });

  it('normalizes case and whitespace and removes duplicate tags', () => {
    expect(normalizeTags(['OS', ' os ', '', 'ipc', 'IPC'])).toEqual(['ipc', 'os']);
  });

  it('validates empty front/back rather than creating unstudyable notes', () => {
    expect(() =>
      createCard({ id: 'a', deckId: 'd', type: 'basic', front: ' ', back: 'answer' }, 100),
    ).toThrow();
    expect(() =>
      createCard({ id: 'a', deckId: 'd', type: 'basic', front: 'question', back: '' }, 100),
    ).toThrow();
  });

  it('rejects a timestamp outside the JavaScript Date range', () => {
    expect(() =>
      createCard({ id: 'n', deckId: 'd', type: 'basic', front: 'Q', back: 'A' }, 1e100),
    ).toThrow();
  });
});
