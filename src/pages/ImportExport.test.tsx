// @vitest-environment jsdom
import Dexie from 'dexie';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProvider } from '../contexts/AppProvider';
import { SmartRecallDB } from '../db/database';
import { ensureInitialized } from '../services/settingsService';
import { createDeck } from '../services/deckService';
import { saveCard } from '../services/cardService';
import { exportBackup } from '../domain/importExport/backup';
import ImportExport from './ImportExport';

const databases: SmartRecallDB[] = [];
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await Dexie.delete(database.name);
    }),
  );
});
async function fresh() {
  const database = new SmartRecallDB(`import-ui-${crypto.randomUUID()}`);
  databases.push(database);
  await ensureInitialized(database);
  return database;
}
async function setup() {
  const database = await fresh();
  const deck = await createDeck(database, { name: 'Operating Systems' }, Date.now());
  render(
    <AppProvider database={database}>
      <ImportExport />
    </AppProvider>,
  );
  await screen.findByRole('heading', { name: 'Import / Export' });
  return { database, deck, user: userEvent.setup() };
}

describe('import preview and confirmation', () => {
  it('imports the original vocabulary JSON through a preview and explicit fresh-schedule confirmation', async () => {
    const { database, user } = await setup();
    await user.selectOptions(screen.getByLabelText('Import format'), 'legacy');
    await user.click(screen.getByLabelText('Import contents'));
    await user.paste(
      JSON.stringify([
        {
          word: 'fork()',
          context: 'Creates a process.',
          box: 4,
          nextReview: '2026-10-10',
          lastReviewed: '2026-09-30',
        },
        { word: 'fork()', context: 'Creates a process.' },
      ]),
    );
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByText(
      'Vocabulary import: new Basic cards with fresh study schedules. Legacy review history is not recreated.',
    );
    expect(await database.cards.count()).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Import cards' }));
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));
    await screen.findByText('Imported 1 cards. Skipped 1 duplicates.');
    expect((await database.units.toArray())[0]).toMatchObject({
      state: 'new',
      interval: 0,
      introducedAt: null,
    });
    expect(await database.events.count()).toBe(0);
  });
  it('shows invalid and duplicate rows, writes only after confirmation, and invalidates edited previews', async () => {
    const { database, user } = await setup();
    await user.type(
      screen.getByLabelText('Import contents'),
      'fork() :: Creates a process.\nfork() :: Creates a process.\ninvalid notes',
    );
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByRole('heading', { name: 'Import preview' });
    expect(
      screen.getByText('1 cards to create. Invalid rows will be skipped.'),
    ).toBeInTheDocument();
    expect(screen.getByText('duplicate', { exact: true })).toBeInTheDocument();
    expect(await database.cards.count()).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Import cards' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm card import' });
    expect(await database.cards.count()).toBe(0);
    await user.click(within(dialog).getByRole('button', { name: 'Confirm import' }));
    await screen.findByText('Imported 1 cards. Skipped 1 duplicates and 1 invalid rows.');
    expect(await database.cards.count()).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByRole('heading', { name: 'Import preview' });
    await user.type(screen.getByLabelText('Import contents'), '\nIPC :: Communication');
    expect(screen.queryByRole('heading', { name: 'Import preview' })).not.toBeInTheDocument();
  });
  it('keeps a failed import open with an accessible error and permits a successful retry', async () => {
    const { database, user } = await setup();
    const failWrite = () => {
      throw new Error('Could not save the import.');
    };
    database.cards.hook('creating', failWrite);
    await user.type(screen.getByLabelText('Import contents'), 'fork() :: Creates a process.');
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByRole('heading', { name: 'Import preview' });
    await user.click(screen.getByRole('button', { name: 'Import cards' }));
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the import.');
    expect(screen.getByRole('dialog', { name: 'Confirm card import' })).toBeInTheDocument();
    expect(await database.cards.count()).toBe(0);
    database.cards.hook('creating').unsubscribe(failWrite);
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));
    await screen.findByText('Imported 1 cards. Skipped 0 duplicates.');
    expect(await database.cards.count()).toBe(1);
  });
  it('blocks backup conflicts and restores an empty collection only after confirmation', async () => {
    const source = await fresh();
    const deck = await createDeck(source, { name: 'Source' }, Date.now());
    await saveCard(
      source,
      { deckId: deck.id, type: 'basic', front: 'Question', back: 'Answer' },
      Date.now(),
    );
    const json = await exportBackup(source, Date.now());
    const target = await fresh();
    render(
      <AppProvider database={target}>
        <ImportExport />
      </AppProvider>,
    );
    await screen.findByRole('heading', { name: 'Import / Export' });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Import format'), 'backup');
    // Paste avoids interpreting cloze/JSON braces as user-event keyboard syntax.
    await user.click(screen.getByLabelText('Import contents'));
    await user.paste(json);
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByText(
      'This collection is empty, so the backup preferences will also be restored.',
    );
    await user.click(screen.getByRole('button', { name: 'Restore backup' }));
    expect(await target.cards.count()).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Confirm restore' }));
    await screen.findByText('Backup restored. Existing cards and reviews were preserved.');
    const saved = (await target.cards.toArray())[0];
    await saveCard(
      target,
      {
        id: saved.id,
        deckId: saved.deckId,
        type: 'basic',
        front: 'Changed question',
        back: 'Answer',
      },
      Date.now(),
    );
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByRole('heading', { name: 'Restore blocked' });
    expect(screen.getByRole('button', { name: 'Restore backup' })).toBeDisabled();
    await waitFor(async () => expect(await target.cards.count()).toBe(1));
  });
});
