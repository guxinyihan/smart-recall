import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../contexts/appContext';
import { useClock } from '../hooks/useClock';
import { getDeckStats, calculateAnalytics } from '../domain/analytics/calculations';
import type { Deck } from '../domain/decks/types';
import { createDeck, updateDeck, duplicateDeck, deleteDeck } from '../services/deckService';
import { PageTitle, Notice, Empty, Dialog, Confirmation } from '../components/ui';

function DeckEditor({ deck, onClose }: { deck?: Deck; onClose: () => void }) {
  const { database } = useApp();
  const [name, setName] = useState(deck?.name ?? '');
  const [description, setDescription] = useState(deck?.description ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (deck) await updateDeck(database, deck.id, { name, description }, Date.now());
      else await createDeck(database, { name, description }, Date.now());
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the deck. Retry.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={deck ? 'Edit deck' : 'Create deck'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={save}>
        <label>
          Deck name
          <input
            autoFocus
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
          />
        </label>
        <Notice message={error} error />
        <div className="actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save deck'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default function Decks() {
  const { database, data } = useApp();
  const { deckId } = useParams();
  const now = useClock();
  const [editor, setEditor] = useState<Deck | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Deck | null>(null);
  const [archived, setArchived] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const selected = deckId ? data.decks.find((deck) => deck.id === deckId) : undefined;
  async function action(task: () => Promise<unknown>, result: string) {
    setBusy(true);
    setMessage('');
    try {
      await task();
      setMessage(result);
      setError(false);
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : 'Could not save the deck change. Retry.',
      );
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  if (deckId && !selected)
    return (
      <Empty title="Deck not found">
        <Link to="/decks">Back to decks</Link>
      </Empty>
    );
  const decks = selected
    ? [selected]
    : data.decks.filter((deck) => (archived ? deck.archivedAt !== null : deck.archivedAt === null));
  const analytics = calculateAnalytics(data.events, now, data.settings.timeZone);
  return (
    <>
      <PageTitle
        title={selected?.name ?? 'Decks'}
        description={selected?.description || 'Organize what you want to remember.'}
      >
        <button className="primary" onClick={() => setEditor('new')}>
          Create deck
        </button>
      </PageTitle>
      {selected ? (
        <Link to="/decks">Back to decks</Link>
      ) : (
        <label className="check">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
          />
          Show archived decks
        </label>
      )}
      <Notice message={message} error={error} />
      {!decks.length && (
        <Empty title={archived ? 'No archived decks' : 'Start with a subject'}>
          <p>Create a deck for a course, language or idea you are learning.</p>
          <button onClick={() => setEditor('new')}>Create your first deck</button>
        </Empty>
      )}
      <div className="deck-list">
        {decks.map((deck) => {
          const stats = getDeckStats(
            deck.id,
            data.cards,
            data.units,
            data.events,
            now,
            data.settings.timeZone,
          );
          const activity = analytics.deckActivity.find((item) => item.deckId === deck.id);
          return (
            <article className="deck-row" key={deck.id}>
              <div className="deck-summary">
                <h2>
                  <Link to={`/decks/${encodeURIComponent(deck.id)}`}>{deck.name}</Link>
                </h2>
                <p>{deck.description || 'No description yet.'}</p>
                {deck.archivedAt !== null && <span className="badge">Archived</span>}
                {selected && (
                  <p className="muted">
                    {activity
                      ? `Last studied ${new Date(activity.lastReviewedAt).toLocaleDateString()}`
                      : 'No recorded reviews yet.'}
                  </p>
                )}
              </div>
              <dl className="deck-counts">
                <div>
                  <dt>Notes</dt>
                  <dd>{stats.totalCards}</dd>
                </div>
                <div>
                  <dt>Study units</dt>
                  <dd>{stats.totalUnits}</dd>
                </div>
                <div>
                  <dt>New</dt>
                  <dd>{stats.newUnits}</dd>
                </div>
                <div>
                  <dt>Due</dt>
                  <dd>{stats.dueUnits}</dd>
                </div>
                <div>
                  <dt>Overdue</dt>
                  <dd>{stats.overdueUnits}</dd>
                </div>
                <div>
                  <dt>Reviews today</dt>
                  <dd>{stats.reviewsToday}</dd>
                </div>
              </dl>
              <div className="actions">
                {deck.archivedAt === null && (
                  <>
                    <Link
                      className="button primary"
                      to={`/study?deck=${encodeURIComponent(deck.id)}`}
                    >
                      Study
                    </Link>
                    <Link
                      className="button"
                      to={`/cards?deck=${encodeURIComponent(deck.id)}&add=1`}
                    >
                      Add card
                    </Link>
                  </>
                )}
                <Link className="button" to={`/cards?deck=${encodeURIComponent(deck.id)}`}>
                  Browse cards
                </Link>
                <button disabled={busy} onClick={() => setEditor(deck)}>
                  Edit deck
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(
                      () => duplicateDeck(database, deck.id, Date.now()),
                      'Deck duplicated with fresh study schedules.',
                    )
                  }
                >
                  Duplicate
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(
                      () =>
                        updateDeck(
                          database,
                          deck.id,
                          { archived: deck.archivedAt === null },
                          Date.now(),
                        ),
                      deck.archivedAt === null ? 'Deck archived.' : 'Deck restored.',
                    )
                  }
                >
                  {deck.archivedAt === null ? 'Archive' : 'Unarchive'}
                </button>
              </div>
              {selected && (
                <div className="destructive">
                  <p>Archive to keep your cards. Deletion is available only for an empty deck.</p>
                  <button
                    className="danger"
                    disabled={busy || stats.totalCards > 0}
                    onClick={() => setDeleting(deck)}
                  >
                    Delete empty deck
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {editor && (
        <DeckEditor deck={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} />
      )}
      {deleting && (
        <Confirmation
          title="Delete empty deck"
          description={`Delete “${deleting.name}”? Historical review events will be preserved.`}
          label="Delete deck"
          onConfirm={() => deleteDeck(database, deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
