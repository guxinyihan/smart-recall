export interface ClozeMarker {
  index: number;
  answer: string;
  hint: string | null;
  start: number;
  end: number;
}

export interface ClozeParseResult {
  markers: ClozeMarker[];
  indices: number[];
  errors: string[];
}

/** Supports {{c1::answer}} and {{c1::answer::hint}}. Same IDs hide together. */
export function parseCloze(text: string): ClozeParseResult {
  const markers: ClozeMarker[] = [];
  const errors: string[] = [];
  const syntax = /\{\{c([1-9]\d*)::([^{}]*?)\}\}/g;
  let cursor = 0;
  for (const match of text.matchAll(syntax)) {
    if (/\{\{|\}\}/.test(text.slice(cursor, match.index)))
      errors.push('Invalid or nested cloze syntax.');
    const [answer, ...hintParts] = match[2].split('::');
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index)) errors.push('Cloze IDs must be positive safe integers.');
    if (!answer.trim()) errors.push(`Cloze c${index} needs an answer.`);
    if (hintParts.length > 1) errors.push(`Cloze c${index} has too many separators.`);
    markers.push({
      index,
      answer: answer.trim(),
      hint: hintParts[0]?.trim() || null,
      start: match.index,
      end: match.index + match[0].length,
    });
    cursor = match.index + match[0].length;
  }
  if (/\{\{|\}\}/.test(text.slice(cursor))) errors.push('Invalid or incomplete cloze syntax.');
  if (!markers.length) errors.push('Add at least one cloze, such as {{c1::answer}}.');
  return {
    markers,
    indices: [...new Set(markers.map((marker) => marker.index))].sort((a, b) => a - b),
    errors: [...new Set(errors)],
  };
}

export function renderCloze(text: string, index: number, reveal = false): string {
  const result = parseCloze(text);
  if (result.errors.length) throw new Error(result.errors.join(' '));
  if (!result.indices.includes(index)) throw new Error('This cloze ID does not exist.');
  let rendered = '';
  let cursor = 0;
  for (const marker of result.markers) {
    rendered += text.slice(cursor, marker.start);
    rendered += marker.index === index && !reveal ? `[${marker.hint || '…'}]` : marker.answer;
    cursor = marker.end;
  }
  return rendered + text.slice(cursor);
}
