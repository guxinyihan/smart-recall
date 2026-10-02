import { useApp } from '../contexts/appContext';
import { useClock } from '../hooks/useClock';
import { calculateAnalytics } from '../domain/analytics/calculations';
import { RATINGS } from '../domain/review/types';
import { PageTitle, Empty } from '../components/ui';

export default function Analytics() {
  const { data } = useApp();
  const now = useClock();
  const stats = calculateAnalytics(data.events, now, data.settings.timeZone);
  return (
    <>
      <PageTitle title="Analytics" description="Your recorded study activity, without guesswork." />
      <dl className="metrics">
        <div>
          <dt>Reviews today</dt>
          <dd>{stats.reviewsToday}</dd>
        </div>
        <div>
          <dt>Introduced today</dt>
          <dd>{stats.introducedToday}</dd>
        </div>
        <div>
          <dt>Study streak</dt>
          <dd>
            {stats.currentStreak}
            <small> days</small>
          </dd>
        </div>
        <div>
          <dt>All reviews</dt>
          <dd>{stats.totalReviews}</dd>
        </div>
      </dl>
      {!stats.totalReviews && (
        <Empty title="Your first review starts the story">
          <p>
            Study a card to see your activity here. Imported legacy box values do not create
            invented reviews.
          </p>
        </Empty>
      )}
      <div className="analytics-grid">
        <section>
          <h2>Last 30 study days</h2>
          <div className="heatmap" aria-label="Daily review activity">
            {stats.dailyActivity.map((day) => (
              <div
                className={`heat-cell level-${day.count ? Math.min(4, Math.ceil(day.count / 5)) : 0}`}
                key={day.day}
                title={`${day.day}: ${day.count} reviews`}
                aria-label={`${day.day}: ${day.count} reviews`}
              >
                <span>{Number(day.day.slice(-2))}</span>
              </div>
            ))}
          </div>
          <p className="muted">
            Darker cells mean more reviews. Days use {data.settings.timeZone}.
          </p>
          <details>
            <summary>Daily review counts</summary>
            <ul className="activity-list">
              {stats.dailyActivity.map((day) => (
                <li key={day.day}>
                  {day.day}
                  <span>{day.count}</span>
                </li>
              ))}
            </ul>
          </details>
        </section>
        <section>
          <h2>Rating distribution</h2>
          <dl className="distribution">
            {RATINGS.map((rating) => (
              <div key={rating}>
                <dt>{rating[0].toUpperCase() + rating.slice(1)}</dt>
                <dd>
                  <meter
                    min={0}
                    max={Math.max(1, stats.totalReviews)}
                    value={stats.ratingDistribution[rating]}
                    aria-label={`${rating} ratings`}
                  />
                  <span>{stats.ratingDistribution[rating]}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p>Average rating: {stats.averageRating?.toFixed(2) ?? '—'} / 4</p>
          <p>
            Non-Again rate:{' '}
            {stats.recallSuccessRate === null ? '—' : `${stats.recallSuccessRate.toFixed(1)}%`}
          </p>
          <p className="muted">
            Hard + Good + Easy divided by all recorded ratings, all time. This measures
            self-reported outcomes, not retention.
          </p>
        </section>
      </div>
      <section>
        <h2>Deck activity</h2>
        {!stats.deckActivity.length ? (
          <p className="muted">No deck activity yet.</p>
        ) : (
          <ul className="activity-list">
            {stats.deckActivity.map((deck) => (
              <li key={deck.deckId}>
                <span>
                  {data.decks.find((item) => item.id === deck.deckId)?.name ?? 'Deleted deck'}
                </span>
                <span>
                  {deck.reviews} reviews · {deck.reviewsToday} today
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
