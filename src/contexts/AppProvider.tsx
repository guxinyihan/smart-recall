import { useEffect, useState, type ReactNode } from 'react';
import { liveQuery } from 'dexie';
import { db, loadSnapshot, type SmartRecallDB } from '../db/database';
import { ensureInitialized } from '../services/settingsService';
import { AppContext, type Snapshot } from './appContext';

export function AppProvider({
  children,
  database = db,
}: {
  children: ReactNode;
  database?: SmartRecallDB;
}) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe(): void } | undefined;
    setFailed(false);
    const initialize = async () => {
      let storage: Storage | undefined;
      try {
        storage = window.localStorage;
      } catch {
        /* Optional legacy preference migration. */
      }
      await ensureInitialized(database, storage);
      if (!active) return;
      subscription = liveQuery(() => loadSnapshot(database)).subscribe({
        next: (snapshot) => {
          if (active) setData(snapshot);
        },
        error: (error) => {
          console.error('SmartRecall database unavailable', error);
          if (active) setFailed(true);
        },
      });
    };
    initialize().catch((error) => {
      console.error('SmartRecall initialization failed', error);
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [database, retry]);
  if (failed)
    return (
      <main className="startup">
        <h1>Unable to open your study data</h1>
        <p role="alert">
          Storage could not be opened or upgraded. Your data has not been cleared. Close other
          SmartRecall tabs and retry.
        </p>
        <button onClick={() => setRetry((value) => value + 1)}>Retry opening storage</button>
      </main>
    );
  if (!data)
    return (
      <main className="startup" role="status">
        Opening your local study collection…
      </main>
    );
  return <AppContext.Provider value={{ database, data }}>{children}</AppContext.Provider>;
}
