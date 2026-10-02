import type { CardId } from '../cards/types';

export type Rating = 'again' | 'hard' | 'good' | 'easy';
export const RATINGS: readonly Rating[] = ['again', 'hard', 'good', 'easy'];
export type LearningState = 'new' | 'learning' | 'review' | 'relearning';

export interface SchedulingUnit {
  id: string;
  cardId: CardId;
  deckId: string;
  direction: 'forward' | 'reverse' | 'cloze';
  clozeIndex?: number;
  state: LearningState;
  due: number;
  /** Interval in whole days; 0 denotes a short learning step. */
  interval: number;
  ease: number;
  repetitions: number;
  lapses: number;
  introducedAt: number | null;
  lastReviewedAt: number | null;
  revision: number;
}

export interface ReviewEvent {
  readonly id: string;
  readonly unitId: string;
  readonly cardId: CardId;
  readonly deckId: string;
  readonly timestamp: number;
  readonly rating: Rating;
  readonly previousState: LearningState;
  readonly nextState: LearningState;
  readonly previousInterval: number;
  readonly nextInterval: number;
  readonly previousEase: number;
  readonly nextEase: number;
  readonly previousDue: number;
  readonly nextDue: number;
  /** True on the very first submitted rating, including Again. */
  readonly introduced: boolean;
  readonly durationMs: number;
}

export interface SchedulerSettings {
  initialEase: number;
  minEase: number;
  maxEase: number;
  hardMultiplier: number;
  easyBonus: number;
  againDelayMinutes: number;
  hardDelayMinutes: number;
  maxIntervalDays: number;
}

export interface ApplicationSettings {
  id: 'app';
  dailyNewLimit: number;
  dailyReviewLimit: number;
  /** Explicit IANA time zone keeps quota boundaries stable across device changes. */
  timeZone: string;
  theme: 'light' | 'dark' | 'system';
  showShortcutHints: boolean;
  autoShowAnswer: boolean;
  legacySettingsMigrated: boolean;
  scheduler: SchedulerSettings;
}

export type Settings = ApplicationSettings;

export const DEFAULT_SCHEDULER: Readonly<SchedulerSettings> = Object.freeze({
  initialEase: 2.5,
  minEase: 1.3,
  maxEase: 3,
  hardMultiplier: 1.2,
  easyBonus: 1.3,
  againDelayMinutes: 1,
  hardDelayMinutes: 5,
  maxIntervalDays: 36500,
});

export function defaultSettings(timeZone = 'UTC'): ApplicationSettings {
  // Intl throws for a misspelled or unsupported zone rather than silently changing days.
  new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
  return {
    id: 'app', dailyNewLimit: 20, dailyReviewLimit: 100, timeZone,
    theme: 'system', showShortcutHints: true, autoShowAnswer: false,
    legacySettingsMigrated: false, scheduler: { ...DEFAULT_SCHEDULER },
  };
}
