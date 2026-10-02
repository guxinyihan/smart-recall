import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../contexts/appContext';
import { useClock } from '../hooks/useClock';
import type { Card, CardType } from '../domain/cards/types';
import { parseCloze, renderCloze } from '../domain/cards/cloze';
import { queueCategory } from '../domain/review/queue';
import { saveCard, deleteCard, setCardSuspended } from '../services/cardService';
import { PageTitle, Notice, Empty, Dialog, Confirmation } from '../components/ui';

const typeLabels: Record<CardType, string> = {
  basic: 'Basic',
  reverse: 'Basic + Reverse',
  cloze: 'Cloze',
};
function CardEditor({
  card,
  initialDeck,
  onClose,
}: {
  card?: Card;
  initialDeck: string;
  onClose: () => void;
}) {
  const { database, data } = useApp();
  const [deck, setDeck] = useState(card?.deckId ?? initialDeck);
  const [type, setType] = useState<CardType>(card?.type ?? 'basic');
  const [front, setFront] = useState(card && card.type !== 'cloze' ? card.front : '');
  const [back, setBack] = useState(card && card.type !== 'cloze' ? card.back : '');
  const [text, setText] = useState(card?.type === 'cloze' ? card.text : '');
  const [tags, setTags] = useState(card?.tags.join(', ') ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const parsed = parseCloze(text);
  const duplicate = data.cards.some(
    (item) =>
      item.id !== card?.id &&
      item.deckId === deck &&
      item.type === type &&
      (item.type === 'cloze'
        ? item.text.trim().toLowerCase() === text.trim().toLowerCase()
        : item.front.trim().toLowerCase() === front.trim().toLowerCase() &&
          item.back.trim().toLowerCase() === back.trim().toLowerCase()),
  );
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await saveCard(
        database,
        { id: card?.id, deckId: deck, type, front, back, text, tags: tags.split(',') },
        Date.now(),
      );
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this card. Retry.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={card ? 'Edit card' : 'Add card'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={save}>
        <div className="form-grid">
          <label>
            Deck
            <select value={deck} onChange={(event) => setDeck(event.target.value)} required>
              {data.decks
                .filter((item) => item.archivedAt === null)
                .map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Card type
            <select value={type} onChange={(event) => setType(event.target.value as CardType)}>
              <option value="basic">Basic</option>
              <option value="reverse">Basic + Reverse</option>
              <option value="cloze">Cloze</option>
            </select>
          </label>
        </div>
        {type === 'cloze' ? (
          <>
            <label>
              Cloze text
              <textarea
                autoFocus
                required
                rows={5}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="A semaphore provides {{c1::synchronization}}."
              />
            </label>
            <p className="muted">
              Use {'{{c1::answer}}'} or {'{{c1::answer::hint}}'}. Different numbers create separate
              study units.
            </p>
            {text && (
              <div className="preview">
                <h3>Cloze preview</h3>
                {parsed.errors.length ? (
                  <p>{parsed.errors.join(' ')}</p>
                ) : (
                  parsed.indices.map((index) => <p key={index}>{renderCloze(text, index)}</p>)
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <label>
              Front
              <textarea
                autoFocus
                required
                rows={3}
                value={front}
                onChange={(event) => setFront(event.target.value)}
              />
            </label>
            <label>
              Back
              <textarea
                required
                rows={3}
                value={back}
                onChange={(event) => setBack(event.target.value)}
              />
            </label>
            <p className="muted">
              {type === 'reverse'
                ? 'One note, two separately scheduled directions.'
                : 'One note, one study direction.'}
            </p>
          </>
        )}
        <label>
          Tags (comma separated)
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            list="existing-tags"
          />
        </label>
        <datalist id="existing-tags">
          {[...new Set(data.cards.flatMap((item) => item.tags))].map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
        {duplicate && (
          <p className="notice">
            Similar content exists in this deck. Saving will keep both notes.
          </p>
        )}
        {card && card.type !== type && (
          <p className="notice">
            Matching study directions keep their schedules. New directions start fresh. Historical
            reviews remain.
          </p>
        )}
        <Notice message={error} error />
        <div className="actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save card'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default function Cards() {
  const { database, data } = useApp();
  const [params, setParams] = useSearchParams();
  const now = useClock();
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [type, setType] = useState('');
  const [state, setState] = useState('');
  const [active, setActive] = useState('active');
  const [editor, setEditor] = useState<Card | 'new' | null>(params.has('add') ? 'new' : null);
  const [deleting, setDeleting] = useState<Card | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const deckId = params.get('deck') ?? '';
  const activeDecks = data.decks.filter((deck) => deck.archivedAt === null);
  const firstDeck = activeDecks.find((deck) => deck.id === deckId)?.id ?? activeDecks[0]?.id ?? '';
  function closeEditor() {
    setEditor(null);
    if (params.has('add')) {
      const next = new URLSearchParams(params);
      next.delete('add');
      setParams(next, { replace: true });
    }
  }
  const filtered = data.cards.filter(
    (card) =>
      (!deckId || card.deckId === deckId) &&
      (!tag || card.tags.includes(tag)) &&
      (!type || card.type === type) &&
      (active === 'all' || (active === 'suspended') === card.suspended) &&
      (!query ||
        `${card.type === 'cloze' ? card.text : `${card.front} ${card.back}`} ${card.tags.join(' ')}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())) &&
      (!state ||
        data.units.some(
          (unit) =>
            unit.cardId === card.id &&
            (state === 'scheduled'
              ? unit.due > now && unit.state === 'review'
              : queueCategory(unit, now, data.settings.timeZone) === state &&
                (state === 'new' || state === 'learning' || unit.due <= now)),
        )),
  );
  return (
    <>
      <PageTitle title="Cards" description="Browse your notes and their study directions.">
        <button className="primary" disabled={!firstDeck} onClick={() => setEditor('new')}>
          Add card
        </button>
      </PageTitle>
      {!activeDecks.length && (
        <p className="notice">
          <Link to="/decks">Create an active deck</Link> to add cards.
        </p>
      )}
      <div className="filters">
        <label>
          Search cards
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Question, answer or tag"
          />
        </label>
        <label>
          Deck filter
          <select
            value={deckId}
            onChange={(event) => {
              const next = new URLSearchParams(params);
              if (event.target.value) next.set('deck', event.target.value);
              else next.delete('deck');
              setParams(next);
            }}
          >
            <option value="">All decks</option>
            {data.decks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.name}
                {deck.archivedAt !== null ? ' (archived)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tag filter
          <select value={tag} onChange={(event) => setTag(event.target.value)}>
            <option value="">All tags</option>
            {[...new Set(data.cards.flatMap((card) => card.tags))].sort().map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          Type filter
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All types</option>
            {Object.entries(typeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Due state
          <select value={state} onChange={(event) => setState(event.target.value)}>
            <option value="">All states</option>
            {['new', 'learning', 'due', 'overdue', 'scheduled'].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          Card status
          <select value={active} onChange={(event) => setActive(event.target.value)}>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="all">All cards</option>
          </select>
        </label>
      </div>
      <Notice message={error} error />
      <p className="muted" role="status">
        {filtered.length} notes found
      </p>
      {!filtered.length && (
        <Empty title="No matching cards">
          <p>Add a note or adjust your filters.</p>
        </Empty>
      )}
      <div className="card-list">
        {filtered.map((card) => (
          <article key={`${typeof card.id}:${card.id}`} className="card-row">
            <div>
              <div className="row-meta">
                <span>{data.decks.find((deck) => deck.id === card.deckId)?.name}</span>
                <span className="badge">{typeLabels[card.type]}</span>
                {card.suspended && <span className="badge">Suspended</span>}
              </div>
              <h2>{card.type === 'cloze' ? card.text : card.front}</h2>
              {card.type !== 'cloze' && <p className="card-back">{card.back}</p>}
              <div className="tags">
                {card.tags.map((item) => (
                  <button key={item} className="tag" onClick={() => setTag(item)}>
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div className="actions">
              <button
                disabled={
                  busy || data.decks.find((deck) => deck.id === card.deckId)?.archivedAt !== null
                }
                onClick={() => setEditor(card)}
              >
                Edit
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await setCardSuspended(database, card.id, !card.suspended, Date.now());
                  } catch (reason) {
                    setError(
                      reason instanceof Error ? reason.message : 'Could not change card status.',
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {card.suspended ? 'Resume' : 'Suspend'}
              </button>
              <button className="danger quiet" disabled={busy} onClick={() => setDeleting(card)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
      {editor && (
        <CardEditor
          card={editor === 'new' ? undefined : editor}
          initialDeck={firstDeck}
          onClose={closeEditor}
        />
      )}
      {deleting && (
        <Confirmation
          title="Delete card"
          description="Remove this note and all of its study directions? Recorded review history will remain. You can suspend the card instead."
          label="Delete card"
          onConfirm={() => deleteCard(database, deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
