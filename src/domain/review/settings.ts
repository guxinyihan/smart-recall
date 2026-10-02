import type { ApplicationSettings } from './types';

export function validateSettings(settings: ApplicationSettings): void {
  if (settings.id !== 'app' || !Number.isInteger(settings.dailyNewLimit) || settings.dailyNewLimit < 0 || settings.dailyNewLimit > 1000
    || !Number.isInteger(settings.dailyReviewLimit) || settings.dailyReviewLimit < 0 || settings.dailyReviewLimit > 10000) {
    throw new Error('Daily limits must be whole numbers within the allowed range.');
  }
  try { new Intl.DateTimeFormat('en', { timeZone: settings.timeZone }).format(0); }
  catch { throw new Error('Choose a valid IANA time zone.'); }
  if (!['light', 'dark', 'system'].includes(settings.theme)) throw new Error('Choose a valid theme.');
  if (typeof settings.showShortcutHints !== 'boolean' || typeof settings.autoShowAnswer !== 'boolean'
    || typeof settings.legacySettingsMigrated !== 'boolean') throw new Error('Invalid study preferences.');
  const scheduler = settings.scheduler;
  const schedulerKeys = ['initialEase', 'minEase', 'maxEase', 'hardMultiplier', 'easyBonus', 'againDelayMinutes', 'hardDelayMinutes', 'maxIntervalDays'] as const;
  if (!scheduler || schedulerKeys.some(key => typeof scheduler[key] !== 'number' || !Number.isFinite(scheduler[key]) || scheduler[key] <= 0)
    || scheduler.minEase < 1 || scheduler.maxEase > 10 || scheduler.minEase > scheduler.initialEase
    || scheduler.initialEase > scheduler.maxEase || scheduler.hardMultiplier < 1 || scheduler.hardMultiplier > 10
    || scheduler.easyBonus < 1 || scheduler.easyBonus > 10 || scheduler.againDelayMinutes > 1440
    || scheduler.hardDelayMinutes > 1440 || !Number.isSafeInteger(scheduler.maxIntervalDays) || scheduler.maxIntervalDays > 365000) {
    throw new Error('Scheduler settings are outside the supported bounds.');
  }
}
