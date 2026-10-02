import { useState, type FormEvent } from 'react';
import { useApp } from '../contexts/appContext';
import { PageTitle, Notice } from '../components/ui';
import { saveSettings } from '../services/settingsService';
import type { ApplicationSettings } from '../domain/review/types';

export default function Settings() {
  const { database, data } = useApp();
  const [newLimit, setNewLimit] = useState(String(data.settings.dailyNewLimit));
  const [reviewLimit, setReviewLimit] = useState(String(data.settings.dailyReviewLimit));
  const [timeZone, setTimeZone] = useState(data.settings.timeZone);
  const [theme, setTheme] = useState(data.settings.theme);
  const [hints, setHints] = useState(data.settings.showShortcutHints);
  const [autoShow, setAutoShow] = useState(data.settings.autoShowAnswer);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (!/^\d+$/.test(newLimit) || !/^\d+$/.test(reviewLimit))
        throw new Error('Daily limits must be nonnegative whole numbers.');
      await saveSettings(database, {
        ...data.settings,
        dailyNewLimit: Number(newLimit),
        dailyReviewLimit: Number(reviewLimit),
        timeZone: timeZone.trim(),
        theme,
        showShortcutHints: hints,
        autoShowAnswer: autoShow,
      });
      setError(false);
      setMessage('Preferences saved.');
    } catch (reason) {
      setError(true);
      setMessage(
        reason instanceof Error ? reason.message : 'Preferences could not be saved. Retry.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle title="Settings" description="Build a study routine that fits your day." />
      <form className="settings-form" onSubmit={save}>
        <h2>Daily study limits</h2>
        <p>
          Limits count distinct study directions. The first rating introduces a new direction,
          including Again. Repeated attempts on the same day do not use another place.
        </p>
        <div className="form-grid">
          <label>
            Daily new-card limit
            <input
              disabled={busy}
              required
              type="number"
              min={0}
              max={1000}
              step={1}
              value={newLimit}
              onChange={(event) => setNewLimit(event.target.value)}
            />
          </label>
          <label>
            Daily review limit
            <input
              disabled={busy}
              required
              type="number"
              min={0}
              max={10000}
              step={1}
              value={reviewLimit}
              onChange={(event) => setReviewLimit(event.target.value)}
            />
          </label>
        </div>
        <p className="muted">
          A limit of 0 pauses new introductions or first reviews of existing cards that day. Already
          started cards can still be retried.
        </p>
        <label>
          Study time zone
          <input
            disabled={busy}
            required
            value={timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
            placeholder="Asia/Shanghai"
            aria-describedby="zone-help"
          />
        </label>
        <p id="zone-help" className="muted">
          Use an IANA time zone such as Asia/Shanghai, Europe/London or America/New_York. This
          determines when a study day starts.
        </p>
        <h2>Appearance and study</h2>
        <label>
          Theme
          <select
            disabled={busy}
            value={theme}
            onChange={(event) => setTheme(event.target.value as ApplicationSettings['theme'])}
          >
            <option value="system">Follow system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="check">
          <input
            disabled={busy}
            type="checkbox"
            checked={hints}
            onChange={(event) => setHints(event.target.checked)}
          />
          Show keyboard shortcut hints
        </label>
        <label className="check">
          <input
            disabled={busy}
            type="checkbox"
            checked={autoShow}
            onChange={(event) => setAutoShow(event.target.checked)}
          />
          Automatically show answers during study
        </label>
        <Notice message={message} error={error} />
        <div className="actions">
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save preferences'}
          </button>
        </div>
      </form>
    </>
  );
}
