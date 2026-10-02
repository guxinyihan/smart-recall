import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/** Explicit activation keeps a new app version from interrupting a study session. */
export default function PwaUpdate() {
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(registrationError) {
      console.error('Service worker registration failed:', registrationError);
      setError(
        'Offline setup could not finish. Keep this page open and try reloading when connected.',
      );
    },
  });

  async function applyUpdate() {
    setUpdating(true);
    setError('');
    try {
      await updateServiceWorker(true);
    } catch (updateError) {
      console.error('Service worker update failed:', updateError);
      setError(
        'The update could not finish. Your saved study data is still on this device. Try again when connected.',
      );
      setUpdating(false);
    }
  }

  function dismiss() {
    setNeedRefresh(false);
    setOfflineReady(false);
    setError('');
  }

  if (!needRefresh && !offlineReady && !error) return null;

  return (
    <aside className="pwa-notice" aria-label="Application updates">
      <p role={error ? 'alert' : 'status'}>
        {error ||
          (needRefresh
            ? 'A SmartRecall update is ready. Save your changes before reloading.'
            : 'App assets are cached for offline use. Study data stays on this device.')}
      </p>
      {needRefresh && (
        <button type="button" onClick={() => void applyUpdate()} disabled={updating}>
          {updating ? 'Updating…' : 'Update and reload'}
        </button>
      )}
      <button type="button" onClick={dismiss} disabled={updating}>
        {needRefresh ? 'Later' : 'Dismiss'}
      </button>
    </aside>
  );
}
