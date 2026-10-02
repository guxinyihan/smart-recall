import { createContext, useContext } from 'react';
import type { SmartRecallDB, loadSnapshot } from '../db/database';

export type Snapshot = Awaited<ReturnType<typeof loadSnapshot>>;
export const AppContext = createContext<{ database: SmartRecallDB; data: Snapshot } | null>(null);
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('Application data is unavailable.');
  return context;
}
