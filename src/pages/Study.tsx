import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useApp } from '../contexts/appContext';
import { useClock } from '../hooks/useClock';
import { buildQueue, type QueueEntry } from '../domain/review/queue';
import { cardContent } from '../domain/cards/cardFactory';
import { scheduleReview } from '../domain/review/scheduler';
import { RATINGS, type Rating, type ReviewEvent } from '../domain/review/types';
import { submitReview } from '../services/reviewService';
import { PageTitle, Notice, Empty, Confirmation } from '../components/ui';

function intervalLabel(due: number, now: number) {
  const minutes = Math.max(1, Math.round((due - now) / 60000));
  return minutes < 60
    ? `${minutes} min`
    : minutes < 1440
      ? `${Math.round(minutes / 60)} hr`
      : `${Math.round(minutes / 1440)} d`;
}

export default function Study() {
  const { database, data } = useApp();
  const [params, setParams] = useSearchParams();
  const deckId = params.get('deck') ?? '';
  const now = useClock(1000);
  const [session, setSession] = useState<QueueEntry[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const [exit, setExit] = useState(false);
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [started, setStarted] = useState(0);
  const [finished, setFinished] = useState(0);
  const shownAt = useRef(0);
  const revealButton = useRef<HTMLButtonElement>(null);
  const firstRating = useRef<HTMLButtonElement>(null);
  const queue = buildQueue({ ...data, now, deckId: deckId || undefined });
  const pendingCount = Object.values(queue.counts).reduce((total, count) => total + count, 0);
  const current = session?.[index];
  const completed = session !== null && !current;
  const content = current ? cardContent(current.card, current.unit) : null;
  const reset = () => {
    setSession(null);
    setEvents([]);
    setError('');
    setExit(false);
  };
  const rate = useCallback(
    async (rating: Rating) => {
      if (!current || !revealed || inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError('');
      const submittedAt = Date.now();
      try {
        const result = await submitReview(database, {
          unitId: current.unit.id,
          expectedRevision: current.unit.revision,
          expectedCardRevision: current.card.revision,
          rating,
          now: submittedAt,
          durationMs: Math.max(0, submittedAt - shownAt.current),
        });
        setEvents((previous) => [...previous, result.event]);
        setIndex((previous) => previous + 1);
        setRevealed(data.settings.autoShowAnswer);
        shownAt.current = Date.now();
        if (session && index + 1 === session.length) setFinished(Date.now());
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : 'The review could not be saved. Your card has not advanced. Retry.',
        );
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [current, database, revealed, data.settings.autoShowAnswer, session, index],
  );
  useEffect(() => {
    if (!current) return;
    if (revealed) firstRating.current?.focus();
    else revealButton.current?.focus();
  }, [current, revealed]);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (
        !current ||
        busy ||
        exit ||
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        target?.closest('input,textarea,select,[contenteditable="true"],dialog')
      )
        return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (!revealed) setRevealed(true);
      }
      if (revealed && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault();
        void rate(RATINGS[Number(event.key) - 1]);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setExit(true);
      }
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [current, revealed, busy, exit, rate]);
  const elapsed = started ? Math.max(0, Math.floor(((finished || now) - started) / 1000)) : 0;
  return (
    <>
      <PageTitle title="Study" description="Recall first. Reveal, then choose an honest rating." />
      {!session && (
        <>
          <label className="study-deck">
            Study deck
            <select
              value={deckId}
              onChange={(event) =>
                setParams(event.target.value ? { deck: event.target.value } : {})
              }
            >
              <option value="">All active decks</option>
              {data.decks
                .filter((deck) => deck.archivedAt === null)
                .map((deck) => (
                  <option value={deck.id} key={deck.id}>
                    {deck.name}
                  </option>
                ))}
            </select>
          </label>
          <section className="study-start">
            <h2>
              {queue.entries.length
                ? `${queue.entries.length} study units ready`
                : pendingCount
                  ? 'Your daily limits are reached'
                  : 'You are caught up for now'}
            </h2>
            <p>
              {queue.counts.new} new · {queue.counts.learning} learning · {queue.counts.due} due ·{' '}
              {queue.counts.overdue} overdue before daily limits
            </p>
            <p className="muted">
              {queue.usage.introducedToday}/{data.settings.dailyNewLimit} new introductions today ·{' '}
              {queue.usage.reviewedToday}/{data.settings.dailyReviewLimit} existing units today
            </p>
            {queue.entries.length ? (
              <button
                className="primary"
                onClick={() => {
                  const time = Date.now();
                  setSession(
                    buildQueue({ ...data, now: time, deckId: deckId || undefined }).entries,
                  );
                  setIndex(0);
                  setEvents([]);
                  setStarted(time);
                  setFinished(0);
                  shownAt.current = time;
                  setRevealed(data.settings.autoShowAnswer);
                  setError('');
                }}
              >
                Start session
              </button>
            ) : (
              <p>
                <Link to="/cards">Add cards</Link> or return when a learning step is due.
              </p>
            )}
          </section>
        </>
      )}
      {current && (
        <section className="study-area">
          <div className="session-meta">
            <span>{data.decks.find((deck) => deck.id === current.card.deckId)?.name}</span>
            <span>
              {index + 1} of {session?.length} · {(session?.length ?? 0) - index} remaining
            </span>
            <span>{elapsed}s</span>
          </div>
          <progress value={index} max={session?.length} aria-label="Session progress" />
          {events.length > 0 && (
            <p className="muted">
              {events.length} reviews saved ·{' '}
              {Math.round(
                (events.filter((event) => event.rating !== 'again').length / events.length) * 100,
              )}
              % non-Again ratings in this session
            </p>
          )}
          <div className="study-card">
            <span className="badge">
              {current.category}{' '}
              {current.unit.direction === 'reverse'
                ? '· reverse'
                : current.unit.direction === 'cloze'
                  ? `· c${current.unit.clozeIndex}`
                  : ''}
            </span>
            <h2 className="question">{content?.question}</h2>
            {revealed ? (
              <div className="answer" aria-live="polite">
                <span className="muted">Answer</span>
                <p>{content?.answer}</p>
              </div>
            ) : (
              <button
                className="primary reveal"
                ref={revealButton}
                onClick={() => setRevealed(true)}
              >
                Reveal answer
              </button>
            )}
          </div>
          <Notice message={error} error />
          {revealed && (
            <div className="ratings">
              {RATINGS.map((rating, number) => (
                <button
                  ref={number === 0 ? firstRating : undefined}
                  key={rating}
                  disabled={busy}
                  onClick={() => void rate(rating)}
                  aria-label={`${rating[0].toUpperCase() + rating.slice(1)}${data.settings.showShortcutHints ? `, shortcut ${number + 1}` : ''}`}
                >
                  <strong>{rating[0].toUpperCase() + rating.slice(1)}</strong>
                  <span>
                    {intervalLabel(
                      scheduleReview(current.unit, rating, now, data.settings.scheduler).due,
                      now,
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
          {data.settings.showShortcutHints && (
            <p className="shortcut-hints">
              Space: reveal · 1: Again · 2: Hard · 3: Good · 4: Easy · Escape: exit
            </p>
          )}
          <div className="actions">
            <button disabled={busy} onClick={() => setExit(true)}>
              End session
            </button>
            {error && (
              <button disabled={busy} onClick={reset}>
                Refresh study queue
              </button>
            )}
          </div>
        </section>
      )}
      {completed && (
        <Empty title="Session complete">
          <p role="status">
            {events.length} reviews saved · {elapsed}s elapsed
          </p>
          <p>
            {events.length
              ? Math.round(
                  (events.filter((event) => event.rating !== 'again').length / events.length) * 100,
                )
              : 0}
            % non-Again ratings in this session
          </p>
          <dl className="session-ratings">
            {RATINGS.map((rating) => (
              <div key={rating}>
                <dt>{rating}</dt>
                <dd>{events.filter((event) => event.rating === rating).length}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">Short learning steps return when their next due time arrives.</p>
          <button className="primary" onClick={reset}>
            Back to study queue
          </button>
          <Link className="button" to="/analytics">
            View analytics
          </Link>
        </Empty>
      )}
      {exit && (
        <Confirmation
          title="End study session"
          description="Your completed reviews are saved. Unanswered cards will remain in the queue."
          label="End session"
          onConfirm={async () => {
            reset();
          }}
          onClose={() => setExit(false)}
        />
      )}
    </>
  );
}
