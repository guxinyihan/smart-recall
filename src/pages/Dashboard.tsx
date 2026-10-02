import { Link } from 'react-router-dom';
import { useApp } from '../contexts/appContext';
import { useClock } from '../hooks/useClock';
import { buildQueue } from '../domain/review/queue';
import { calculateAnalytics, getDeckStats } from '../domain/analytics/calculations';
import { PageTitle, Empty } from '../components/ui';

export default function Dashboard() {
  const { data } = useApp();
  const now = useClock();
  const queue = buildQueue({ ...data, now });
  const analytics = calculateAnalytics(data.events, now, data.settings.timeZone);
  const decks = data.decks.filter((deck) => deck.archivedAt === null);
  return (
    <>
      <PageTitle title="Dashboard" description="A little practice, remembered for longer." />
      <section className="study-invitation">
        <div>
          <h2>Your next study session</h2>
          <p>
            {queue.entries.length
              ? `${queue.entries.length} study units are ready within your daily limits.`
              : 'Nothing is ready to review right now. Add cards or return when your next review is due.'}
          </p>
          <p className="muted">
            {queue.usage.newRemaining} new introductions remaining · {queue.usage.reviewRemaining}{' '}
            existing units remaining today
          </p>
        </div>
        <Link
          className={`button ${queue.entries.length ? 'primary' : ''}`}
          to={queue.entries.length ? '/study' : '/cards'}
        >
          {queue.entries.length ? 'Study Now' : 'Browse cards'}
        </Link>
      </section>
      <dl className="metrics">
        <div>
          <dt>Due now</dt>
          <dd>{queue.counts.due + queue.counts.learning + queue.counts.overdue}</dd>
        </div>
        <div>
          <dt>New available</dt>
          <dd>{queue.entries.filter((entry) => entry.category === 'new').length}</dd>
        </div>
        <div>
          <dt>Overdue</dt>
          <dd>{queue.counts.overdue}</dd>
        </div>
        <div>
          <dt>Reviews today</dt>
          <dd>{analytics.reviewsToday}</dd>
        </div>
        <div>
          <dt>Study streak</dt>
          <dd>
            {analytics.currentStreak}
            <small> days</small>
          </dd>
        </div>
      </dl>
      <div className="section-heading">
        <h2>Your decks</h2>
        <Link to="/decks">Manage decks</Link>
      </div>
      {!decks.length ? (
        <Empty title="What are you learning?">
          <p>Create a deck, then add a question you want to remember.</p>
          <Link className="button primary" to="/decks">
            Create a deck
          </Link>
        </Empty>
      ) : (
        <div className="overview-list">
          {decks.map((deck) => {
            const stats = getDeckStats(
              deck.id,
              data.cards,
              data.units,
              data.events,
              now,
              data.settings.timeZone,
            );
            return (
              <div className="overview-row" key={deck.id}>
                <div>
                  <h3>
                    <Link to={`/decks/${encodeURIComponent(deck.id)}`}>{deck.name}</Link>
                  </h3>
                  <p>
                    {stats.totalCards} notes · {stats.totalUnits} study units
                  </p>
                </div>
                <p>
                  {stats.newUnits} new · {stats.dueUnits} due
                </p>
                <Link className="button" to={`/study?deck=${encodeURIComponent(deck.id)}`}>
                  Study
                </Link>
              </div>
            );
          })}
        </div>
      )}
      <p className="privacy-note">
        Your collection lives on this device. Export a backup to keep a copy elsewhere.
      </p>
    </>
  );
}
