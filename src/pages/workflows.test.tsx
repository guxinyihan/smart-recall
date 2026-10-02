// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Dexie from 'dexie';
import type { ReactNode } from 'react';
import { SmartRecallDB } from '../db/database';
import { AppProvider } from '../contexts/AppProvider';
import { createDeck } from '../services/deckService';
import { saveCard } from '../services/cardService';
import { ensureInitialized } from '../services/settingsService';
import Decks from './Decks';
import Cards from './Cards';
import Study from './Study';

const NOW = Date.UTC(2026, 9, 2, 12);
const databases: SmartRecallDB[] = [];

beforeAll(() => {
  // jsdom has no native modal implementation. Real focus trapping/Escape are also
  // checked in browser E2E; this shim supplies open/close and native autofocus only.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.setAttribute('open', '');
      this.querySelector('[autofocus]')?.focus();
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.removeAttribute('open');
    },
  });
});

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  localStorage.clear();
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await Dexie.delete(database.name);
    }),
  );
});

async function fresh() {
  const database = new SmartRecallDB(`workflow-${crypto.randomUUID()}`, NOW);
  databases.push(database);
  await ensureInitialized(database);
  return database;
}

function renderPage(database: SmartRecallDB, page: ReactNode, initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AppProvider database={database}>{page}</AppProvider>
    </MemoryRouter>,
  );
}

async function studyCollection(count = 4) {
  const database = await fresh();
  const deck = await createDeck(database, { name: 'Operating Systems' }, NOW);
  for (let index = 1; index <= count; index++) {
    await saveCard(
      database,
      { deckId: deck.id, type: 'basic', front: `Question ${index}`, back: `Answer ${index}` },
      NOW,
    );
  }
  return { database, deck };
}

describe('deck and card workflows', () => {
  it('creates a deck through labelled fields and persists its description', async () => {
    const database = await fresh();
    const user = userEvent.setup();
    renderPage(database, <Decks />);
    await user.click(await screen.findByRole('button', { name: 'Create deck' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Create deck' }));
    await user.type(dialog.getByLabelText('Deck name'), 'Operating Systems');
    await user.type(dialog.getByLabelText('Description'), 'Processes and synchronization');
    await user.click(dialog.getByRole('button', { name: 'Save deck' }));
    expect(await screen.findByRole('link', { name: 'Operating Systems' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await database.decks.toArray()).toEqual([
      expect.objectContaining({
        name: 'Operating Systems',
        description: 'Processes and synchronization',
      }),
    ]);
  });

  it('handles native dialog cancellation and restores focus to its launch button', async () => {
    const database = await fresh();
    const user = userEvent.setup();
    renderPage(database, <Decks />);
    const trigger = await screen.findByRole('button', { name: 'Create deck' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Create deck' });
    expect(within(dialog).getByLabelText('Deck name')).toHaveFocus();
    // A browser dispatches cancel when Escape is pressed on an open native dialog.
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(await database.decks.count()).toBe(0);
  });

  it.each([
    { type: 'basic', units: 1 },
    { type: 'reverse', units: 2 },
    { type: 'cloze', units: 2 },
  ])('creates a $type note and its correct number of study units', async ({ type, units }) => {
    const database = await fresh();
    const deck = await createDeck(database, { name: 'Operating Systems' }, NOW);
    const user = userEvent.setup();
    renderPage(database, <Cards />, '/cards');
    await user.click(await screen.findByRole('button', { name: 'Add card' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Add card' }));
    await user.selectOptions(dialog.getByLabelText('Card type'), type);
    if (type === 'cloze') {
      await user.click(dialog.getByLabelText('Cloze text'));
      await user.paste('A {{c1::semaphore}} supports {{c2::synchronization}}.');
      expect(dialog.getByRole('heading', { name: 'Cloze preview' })).toBeVisible();
    } else {
      await user.type(dialog.getByLabelText('Front'), 'What does fork() do?');
      await user.type(dialog.getByLabelText('Back'), 'Creates a new process.');
    }
    await user.type(dialog.getByLabelText('Tags (comma separated)'), ' OS , ipc, os');
    await user.click(dialog.getByRole('button', { name: 'Save card' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await database.cards.toArray()).toEqual([
      expect.objectContaining({ deckId: deck.id, type, tags: ['ipc', 'os'] }),
    ]);
    expect(await database.units.count()).toBe(units);
    expect(await screen.findByText('1 notes found')).toBeVisible();
  });

  it('combines deck, normalized tag, type and text filters without counting reverse notes twice', async () => {
    const database = await fresh();
    const os = await createDeck(database, { name: 'Operating Systems' }, NOW);
    const networks = await createDeck(database, { name: 'Networks' }, NOW);
    await saveCard(
      database,
      {
        deckId: os.id,
        type: 'basic',
        front: 'fork()',
        back: 'Creates a process',
        tags: ['OS', 'fork'],
      },
      NOW,
    );
    await saveCard(
      database,
      { deckId: os.id, type: 'reverse', front: 'semaphore', back: 'Synchronization', tags: ['os'] },
      NOW,
    );
    await saveCard(
      database,
      {
        deckId: networks.id,
        type: 'basic',
        front: 'TCP',
        back: 'Reliable stream',
        tags: ['network'],
      },
      NOW,
    );
    const user = userEvent.setup();
    renderPage(database, <Cards />, '/cards');
    expect(await screen.findByText('3 notes found')).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Deck filter'), networks.id);
    expect(screen.getByRole('heading', { name: 'TCP' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'fork()' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Deck filter'), '');
    await user.selectOptions(screen.getByLabelText('Tag filter'), 'os');
    expect(screen.getByText('2 notes found')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'TCP' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Deck filter'), os.id);
    await user.selectOptions(screen.getByLabelText('Type filter'), 'reverse');
    expect(screen.getByText('1 notes found')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'semaphore' })).toBeVisible();
    await user.type(screen.getByLabelText('Search cards'), 'fork');
    expect(screen.getByRole('heading', { name: 'No matching cards' })).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Type filter'), 'basic');
    expect(screen.getByRole('heading', { name: 'fork()' })).toBeVisible();
    expect(screen.getByText('1 notes found')).toBeVisible();
  });
});

describe('study workflow and persistence failures', () => {
  it('requires reveal, then accepts all four keyboard ratings and persists every event', async () => {
    const { database } = await studyCollection();
    const user = userEvent.setup();
    renderPage(database, <Study />, '/study');
    await user.click(await screen.findByRole('button', { name: 'Start session' }));
    expect(screen.queryByRole('button', { name: /^Again/ })).not.toBeInTheDocument();
    await user.keyboard('1');
    expect(await database.events.count()).toBe(0);
    expect(screen.getByText('1 of 4 · 4 remaining')).toBeVisible();
    const ratings = ['again', 'hard', 'good', 'easy'];
    for (let index = 0; index < 4; index++) {
      await user.keyboard(' ');
      expect(screen.getByRole('button', { name: /^Again/ })).toHaveFocus();
      if (index === 0) {
        // A second Space must not activate the focused Again button by default.
        await user.keyboard(' ');
        expect(await database.events.count()).toBe(0);
        expect(screen.getByText('1 of 4 · 4 remaining')).toBeVisible();
      }
      await user.keyboard(String(index + 1));
      await waitFor(async () => expect(await database.events.count()).toBe(index + 1));
      if (index < 3)
        expect(await screen.findByText(`${index + 2} of 4 · ${3 - index} remaining`)).toBeVisible();
    }
    expect(await screen.findByRole('heading', { name: 'Session complete' })).toBeVisible();
    expect(screen.getByText('4 reviews saved · 0s elapsed')).toBeVisible();
    expect(screen.getByText('75% non-Again ratings in this session')).toBeVisible();
    expect((await database.events.toArray()).map((event) => event.rating).sort()).toEqual(
      ratings.sort(),
    );
    expect((await database.events.toArray()).every((event) => event.introduced)).toBe(true);
  });

  it('preserves text-input typing and ignores repeated or modified shortcuts', async () => {
    const { database } = await studyCollection(1);
    const user = userEvent.setup();
    renderPage(
      database,
      <>
        <Study />
        <input aria-label="Study annotation" />
        <textarea aria-label="Study notes" />
        <div contentEditable aria-label="Editable note" />
      </>,
      '/study',
    );
    await user.click(await screen.findByRole('button', { name: 'Start session' }));
    await user.click(screen.getByLabelText('Study annotation'));
    await user.type(screen.getByLabelText('Study annotation'), 'remember 1 2 3 4');
    expect(screen.getByRole('button', { name: 'Reveal answer' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Reveal answer' }));
    for (const label of ['Study annotation', 'Study notes', 'Editable note']) {
      fireEvent.keyDown(screen.getByLabelText(label), { key: '1', code: 'Digit1' });
    }
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', repeat: true });
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', ctrlKey: true });
    expect(await database.events.count()).toBe(0);
    expect(screen.getByText('1 of 1 · 1 remaining')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /^Good/ }));
    expect(await screen.findByRole('heading', { name: 'Session complete' })).toBeVisible();
    expect(await database.events.count()).toBe(1);
  });

  it('keeps the current card and session progress when a review write fails, then retries and reloads safely', async () => {
    const { database } = await studyCollection(2);
    const user = userEvent.setup();
    const view = renderPage(database, <Study />, '/study');
    await user.click(await screen.findByRole('button', { name: 'Start session' }));
    const question = screen.getByRole('heading', { name: /^Question/ }).textContent;
    const card = (await database.cards.toArray()).find(
      (card) => card.type !== 'cloze' && card.front === question,
    )!;
    const before = (await database.units.where('cardId').equals(card.id).toArray())[0];
    const failWrite = () => {
      throw new Error('The review could not be stored. Retry.');
    };
    database.events.hook('creating', failWrite);
    await user.click(screen.getByRole('button', { name: 'Reveal answer' }));
    await user.click(screen.getByRole('button', { name: /^Good/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The review could not be stored. Retry.',
    );
    expect(screen.getByRole('heading', { name: question! })).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Session progress' })).toHaveAttribute(
      'value',
      '0',
    );
    expect(screen.getByText('1 of 2 · 2 remaining')).toBeVisible();
    expect(await database.units.get(before.id)).toEqual(before);
    expect(await database.events.count()).toBe(0);
    database.events.hook('creating').unsubscribe(failWrite);
    await user.click(screen.getByRole('button', { name: /^Good/ }));
    expect(await screen.findByText('2 of 2 · 1 remaining')).toBeVisible();
    expect(await database.events.toArray()).toEqual([
      expect.objectContaining({ cardId: card.id, rating: 'good', introduced: true }),
    ]);
    expect((await database.units.get(before.id))?.revision).toBe(1);
    view.unmount();
    database.close();
    await database.open();
    renderPage(database, <Study />, '/study');
    expect(await screen.findByRole('heading', { name: '1 study units ready' })).toBeVisible();
    expect(screen.getByText(/1\/20 new introductions today/)).toBeVisible();
    expect(await database.events.count()).toBe(1);
  });
});
