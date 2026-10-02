import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useApp } from '../contexts/appContext';
import { PageTitle, Notice, Dialog } from '../components/ui';
import { previewTextImport, commitTextImport } from '../services/importService';
import { exportCardsCsv, type ImportPreview } from '../domain/importExport/text';
import {
  exportBackup,
  previewBackup,
  mergeBackup,
  type BackupPreview,
} from '../domain/importExport/backup';

type Preview = { kind: 'cards'; value: ImportPreview } | { kind: 'backup'; value: BackupPreview };
type Format = 'notes' | 'csv' | 'legacy' | 'backup';

function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Keep the URL alive until the browser has started the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ImportExport() {
  const { database, data } = useApp();
  const [format, setFormat] = useState<Format>('notes');
  const [deckId, setDeckId] = useState(
    data.decks.find((deck) => deck.archivedAt === null)?.id ?? '',
  );
  const [text, setText] = useState('');
  const [policy, setPolicy] = useState<'skip' | 'keep'>('skip');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const activeDecks = data.decks.filter((deck) => deck.archivedAt === null);
  const destination = activeDecks.some((deck) => deck.id === deckId)
    ? deckId
    : (activeDecks[0]?.id ?? '');
  const cardsToCreate =
    preview?.kind === 'cards'
      ? preview.value.valid + (policy === 'keep' ? preview.value.duplicates : 0)
      : (preview?.value.cardsToCreate ?? 0);
  const canImport =
    !!preview &&
    (preview.kind === 'cards' ? cardsToCreate > 0 : preview.value.conflicts.length === 0);
  function changed() {
    setPreview(null);
    setConfirm(false);
    setMessage('');
  }
  function failure(reason: unknown, fallback: string) {
    setError(true);
    setMessage(reason instanceof Error ? reason.message : fallback);
  }
  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    changed();
    setBusy(true);
    try {
      setText(await file.text());
    } catch (reason) {
      failure(reason, 'The file could not be read. Select it again or paste its contents.');
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  }
  async function makePreview(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setPreview(null);
    try {
      if (format === 'backup')
        setPreview({ kind: 'backup', value: await previewBackup(database, text) });
      else
        setPreview({
          kind: 'cards',
          value: await previewTextImport(database, text, format, destination),
        });
    } catch (reason) {
      failure(reason, 'The import could not be previewed. Check the contents and retry.');
    } finally {
      setBusy(false);
    }
  }
  async function applyImport() {
    if (!preview) return;
    setBusy(true);
    setMessage('');
    try {
      if (preview.kind === 'backup') {
        await mergeBackup(database, preview.value);
        setMessage('Backup restored. Existing cards and reviews were preserved.');
      } else {
        const result = await commitTextImport(database, preview.value, policy, Date.now());
        setMessage(
          `Imported ${result.created} cards. Skipped ${result.skipped} duplicates${preview.value.invalid ? ` and ${preview.value.invalid} invalid rows` : ''}.`,
        );
      }
      setError(false);
      setConfirm(false);
      setPreview(null);
    } catch (reason) {
      failure(
        reason,
        'The import could not be saved. Your collection has not been partially changed. Retry.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function exportFile(kind: 'backup' | 'csv') {
    setBusy(true);
    setMessage('');
    try {
      const date = new Date().toISOString().slice(0, 10);
      if (kind === 'backup')
        download(
          await exportBackup(database, Date.now()),
          `smart-recall-backup-${date}.json`,
          'application/json',
        );
      else
        download(
          exportCardsCsv(data.cards, data.decks),
          `smart-recall-cards-${date}.csv`,
          'text/csv;charset=utf-8',
        );
      setError(false);
      setMessage(`${kind === 'backup' ? 'Backup' : 'CSV'} download started.`);
    } catch (reason) {
      failure(reason, 'The export could not be created. Retry.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="Import / Export"
        description="Turn notes into cards, or keep a copy of your collection."
      />
      {!confirm && <Notice message={message} error={error} />}
      <section className="export-section" aria-labelledby="export-title">
        <h2 id="export-title">Export your collection</h2>
        <p>
          A full backup includes decks, cards, study schedules, review history and preferences. CSV
          shares card content and tags.
        </p>
        <div className="actions">
          <button disabled={busy} onClick={() => void exportFile('backup')}>
            Download JSON backup
          </button>
          <button disabled={busy || !data.cards.length} onClick={() => void exportFile('csv')}>
            Download CSV cards
          </button>
        </div>
      </section>
      <section aria-labelledby="import-title">
        <h2 id="import-title">Import</h2>
        <form onSubmit={makePreview}>
          <div className="form-grid">
            <label>
              Import format
              <select
                disabled={busy}
                value={format}
                onChange={(event) => {
                  changed();
                  setFormat(event.target.value as Format);
                }}
              >
                <option value="notes">Notes to cards</option>
                <option value="csv">CSV cards</option>
                <option value="legacy">Vocabulary JSON (original app)</option>
                <option value="backup">JSON backup</option>
              </select>
            </label>
            {format !== 'backup' && (
              <label>
                Destination deck
                <select
                  disabled={busy}
                  required
                  value={destination}
                  onChange={(event) => {
                    changed();
                    setDeckId(event.target.value);
                  }}
                >
                  <option value="" disabled>
                    Select a deck
                  </option>
                  {activeDecks.map((deck) => (
                    <option value={deck.id} key={deck.id}>
                      {deck.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {format === 'notes' && (
            <p className="muted">
              One card per line. Use Term :: Definition, Question ? Answer, or{' '}
              {'{{c1::cloze text}}'}.
            </p>
          )}
          {format === 'csv' && (
            <p className="muted">
              Required columns: type, front, back. Optional: deck, text, tags. Types: basic,
              reverse, cloze. Separate tags with semicolons; new deck names will be previewed.
            </p>
          )}
          {format === 'backup' && (
            <p className="muted">
              Restore a SmartRecall JSON backup. Matching records are skipped; changed records stop
              the restore so existing data stays safe.
            </p>
          )}
          {format === 'legacy' && (
            <p className="muted">
              Import the original app's word and context JSON array. These become new Basic cards
              with fresh study schedules. Existing schedules are preserved by the automatic upgrade
              when SmartRecall opens at the original app's address.
            </p>
          )}
          <label>
            Choose import file
            <input
              type="file"
              disabled={busy}
              accept={
                format === 'backup' || format === 'legacy'
                  ? '.json,application/json'
                  : format === 'csv'
                    ? '.csv,text/csv'
                    : '.txt,text/plain'
              }
              onChange={(event) => void readFile(event)}
            />
          </label>
          <label>
            Import contents
            <textarea
              required
              rows={8}
              disabled={busy}
              value={text}
              onChange={(event) => {
                changed();
                setText(event.target.value);
              }}
              placeholder={
                format === 'notes'
                  ? 'fork() :: Creates a new process.\nIPC ? Inter-Process Communication'
                  : format === 'csv'
                    ? 'type,front,back,tags\nbasic,fork(),Creates a process.,os;fork'
                    : format === 'legacy'
                      ? '[{"word":"fork()","context":"Creates a new process."}]'
                      : 'Paste your JSON backup here.'
              }
            />
          </label>
          <div className="actions">
            <button
              className="primary"
              disabled={busy || !text.trim() || (format !== 'backup' && !destination)}
            >
              {busy ? 'Working…' : 'Preview import'}
            </button>
          </div>
        </form>
      </section>
      {preview && (
        <section className="import-preview" aria-labelledby="preview-title">
          <h2 id="preview-title">Import preview</h2>
          {preview.kind === 'cards' ? (
            <>
              {preview.value.format === 'legacy' && (
                <p>
                  Vocabulary import: new Basic cards with fresh study schedules. Legacy review
                  history is not recreated.
                </p>
              )}
              <dl className="metrics">
                <div>
                  <dt>Total rows</dt>
                  <dd>{preview.value.total}</dd>
                </div>
                <div>
                  <dt>Valid</dt>
                  <dd>{preview.value.valid}</dd>
                </div>
                <div>
                  <dt>Invalid</dt>
                  <dd>{preview.value.invalid}</dd>
                </div>
                <div>
                  <dt>Duplicates</dt>
                  <dd>{preview.value.duplicates}</dd>
                </div>
              </dl>
              <label>
                Duplicate handling
                <select
                  disabled={busy}
                  value={policy}
                  onChange={(event) => {
                    setPolicy(event.target.value as 'skip' | 'keep');
                    setMessage('');
                  }}
                >
                  <option value="skip">Skip duplicates</option>
                  <option value="keep">Keep both</option>
                </select>
              </label>
              <p>
                {cardsToCreate} cards to create.{' '}
                {preview.value.invalid > 0 && 'Invalid rows will be skipped.'}
              </p>
              {preview.value.decksToCreate.length > 0 && (
                <p>Decks to create: {preview.value.decksToCreate.join(', ')}</p>
              )}
              <ol className="preview-rows">
                {preview.value.rows.map((row) => (
                  <li key={row.line}>
                    <span className="badge">{row.status}</span>
                    <strong>Row {row.line}</strong>
                    <p>
                      {row.error ??
                        (row.input?.type === 'cloze'
                          ? row.input.text
                          : `${row.input?.front} → ${row.input?.back}`)}
                    </p>
                    {row.input?.deckName && <small>Deck: {row.input.deckName}</small>}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <>
              <dl className="metrics">
                <div>
                  <dt>Cards in backup</dt>
                  <dd>{preview.value.total}</dd>
                </div>
                <div>
                  <dt>Cards to create</dt>
                  <dd>{preview.value.cardsToCreate}</dd>
                </div>
                <div>
                  <dt>Decks to create</dt>
                  <dd>{preview.value.decksToCreate}</dd>
                </div>
                <div>
                  <dt>Reviews to restore</dt>
                  <dd>{preview.value.eventsToCreate}</dd>
                </div>
              </dl>
              <p>
                {preview.value.unitsToCreate} study directions to restore.{' '}
                {preview.value.duplicates} identical records will be skipped.
              </p>
              <p>
                {preview.value.restoreSettings
                  ? 'This collection is empty, so the backup preferences will also be restored.'
                  : 'Your current preferences will be kept.'}
              </p>
              {preview.value.conflicts.length > 0 && (
                <div role="alert">
                  <h3>Restore blocked</h3>
                  <p>
                    These records differ from your current collection. Nothing will be overwritten.
                  </p>
                  <ul>
                    {preview.value.conflicts.map((conflict, index) => (
                      <li key={index}>{conflict}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <div className="actions">
            <button
              className="primary"
              disabled={busy || !canImport}
              onClick={() => {
                setMessage('');
                setConfirm(true);
              }}
            >
              {preview.kind === 'backup' ? 'Restore backup' : 'Import cards'}
            </button>
          </div>
        </section>
      )}
      {confirm && preview && (
        <Dialog
          title={preview.kind === 'backup' ? 'Confirm backup restore' : 'Confirm card import'}
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <p>
            {preview.kind === 'backup'
              ? `Restore ${preview.value.cardsToCreate} cards, ${preview.value.decksToCreate} decks and ${preview.value.eventsToCreate} reviews? Existing records will be preserved.`
              : `Create ${cardsToCreate} cards? ${policy === 'skip' ? 'Duplicates will be skipped.' : 'Duplicate cards will be kept.'} ${preview.value.invalid ? `${preview.value.invalid} invalid rows will be skipped.` : ''}`}
          </p>
          <Notice message={message} error={error} />
          <div className="actions">
            <button disabled={busy} onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button className="primary" disabled={busy} onClick={() => void applyImport()}>
              {busy ? 'Saving…' : preview.kind === 'backup' ? 'Confirm restore' : 'Confirm import'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
