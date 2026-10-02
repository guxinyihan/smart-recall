import type { SmartRecallDB } from '../db/database';
import { defaultSettings, type ApplicationSettings } from '../domain/review/types';
import { validateSettings } from '../domain/review/settings';
export { validateSettings } from '../domain/review/settings';

export async function saveSettings(
  database: SmartRecallDB,
  settings: ApplicationSettings,
): Promise<void> {
  validateSettings(settings);
  await database.settings.put(settings);
}

/** Called by the application bootstrap, independently of React rendering. */
export async function ensureInitialized(
  database: SmartRecallDB,
  storage?: Pick<Storage, 'getItem'>,
): Promise<void> {
  await database.open();
  await database.transaction('rw', database.settings, async () => {
    const settings = (await database.settings.get('app')) ?? defaultSettings();
    if (settings.legacySettingsMigrated) return;
    if (storage) {
      try {
        const darkMode = storage.getItem('darkMode');
        if (darkMode === 'true' || darkMode === 'false')
          settings.theme = darkMode === 'true' ? 'dark' : 'light';
        const newLimit = storage.getItem('dailyNewWords');
        if (newLimit !== null && /^\d+$/.test(newLimit) && Number(newLimit) <= 1000)
          settings.dailyNewLimit = Number(newLimit);
        const autoShow = storage.getItem('autoShowAnswer');
        if (autoShow === 'true' || autoShow === 'false')
          settings.autoShowAnswer = autoShow === 'true';
        settings.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      } catch {
        // localStorage may be unavailable in private browsing. IndexedDB defaults remain valid.
      }
    }
    await database.settings.put({ ...settings, legacySettingsMigrated: true });
  });
}
