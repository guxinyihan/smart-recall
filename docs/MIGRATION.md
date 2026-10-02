# Version-1 data migration

SmartRecall upgrades the existing database without discarding it. The audited upstream commit is `181ca58acc93238dc1b9192f04b33d4fa561a5af`; its full 28-commit Git history is preserved.

## Original schema and origin

The upstream Dexie database is named `flashcardDB`. Version 1 declares:

```ts
words: '++id, word, box, nextReview';
```

Records normally have `id`, `word`, `context`, `box`, `nextReview`, and `lastReviewed`. The TypeScript interface described strings, but auto-increment keys can be numeric. Both kinds remain exact.

Automatic upgrade requires the original browser profile and origin: the same scheme, host, and port. Changing repository/branding does not move IndexedDB. A different origin leaves the old origin's database separate and untouched. Export original vocabulary JSON for manual content transfer when needed; that import creates fresh notes/schedules rather than migrating historical state.

## Dexie upgrade transaction

`db/database.ts` declares both versions. V2 retains `words` and adds decks, notes, scheduling units, events, and settings. The `.upgrade()` callback reads old records, creates **Imported Vocabulary** (`legacy-imported-vocabulary`) when records exist, and writes Basic notes/units in the version-upgrade transaction.

Empty v1/fresh v2 databases initialize settings without invented cards or history. Dexie executes the version change once; reopening v2 does not repeat it. An upgrade failure aborts rather than committing partial conversion. Migration is independent of React, never deletes `words`, and never clears browser storage.

## Field conversion

| Legacy value            | Mapping                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `id`                    | Exact numeric/string note ID                                           |
| `word`, `context`       | Basic front/back; valid nonempty strings preserve exact whitespace     |
| `nextReview`            | Due timestamp for a valid date at local midnight                       |
| `lastReviewed`          | Last-review timestamp when valid and after the never-reviewed sentinel |
| `box`                   | Initial interval/state/repetition approximation below                  |
| `createdAt`             | Supported timestamp/date if present; otherwise inferred                |
| Unmapped/invalid fields | Original value remains in archived `words`                             |

Missing/invalid front becomes `[Legacy entry <id>]`; missing/invalid back becomes `[No definition in legacy record]`. Raw records retain their original values. Duplicate-looking records with different IDs stay separate notes.

Creation time uses valid `createdAt`, otherwise a 13-digit numeric string ID as the upstream millisecond timestamp, otherwise injected migration time. This is an approximation because upstream did not reliably store creation timestamps. `updatedAt` initially matches it; note revision starts at zero.

Valid `YYYY-MM-DD` dates become local midnight to match the old calendar meaning. Impossible dates or unsupported numeric timestamps are rejected. Invalid due values fall back to migration time. Numeric dates must be finite, nonnegative, and within JavaScript's supported Date range. The sentinel `1970-01-01` means never reviewed; a usable later last-review date indicates prior study without establishing complete history.

## Box conversion

| Box | Interval, days | Behavior                                           |
| --- | -------------- | -------------------------------------------------- |
| 1   | 0              | New without a usable review date; otherwise review |
| 2   | 2              | Review                                             |
| 3   | 4              | Review                                             |
| 4   | 7              | Review                                             |
| 5   | 14             | Review                                             |
| 6   | 14             | Suspended Basic note, review state                 |

Invalid boxes fall back to box 1. Valid due dates are retained independently. A box-6 `9999-12-31` due date remains when valid; suspension excludes the note from normal queues. No mastery claim is inferred. Resuming it does not reset that preserved far-future date; edits preserve the matching direction's schedule.

Units start with ease `2.5`, lapses `0`, and revision `0`. Previously reviewed notes receive `max(1, box - 1)` repetitions. Introduction time uses a usable last-review date, or inferred creation time for boxes above 1 without a usable review date. These approximate current state; the old app did not store a full SM-2 state. Future ratings use the new scheduler.

## History and quotas

Migration creates **no review events**. Boxes/last-reviewed fields cannot reconstruct rating counts, outcomes, or consumed daily quotas. Legacy data therefore invents no streak, rating distribution, retention, or historical quota usage.

Migrated introduced units use existing-unit accounting on future reviews. Never-reviewed migrated units consume a new introduction place on their first committed rating, including Again. Subsequent accounting comes from saved immutable events and survives reopening.

## Preference migration

`ensureInitialized()` opens the database and imports old localStorage preferences once:

| Key                                           | Setting                  |
| --------------------------------------------- | ------------------------ |
| `darkMode` equal to `true`/`false`            | Dark/light theme         |
| Supported nonnegative `dailyNewWords` integer | Daily new-unit limit     |
| `autoShowAnswer` equal to `true`/`false`      | Automatic answer display |

Browser bootstrap initially uses the resolved IANA zone when optional localStorage access succeeds; otherwise UTC. Missing/invalid preferences leave defaults: 20 new units, 100 existing units, system theme, shortcut hints, answers hidden.

The transactional `legacySettingsMigrated` marker prevents future initialization from overwriting changed SmartRecall preferences. Original localStorage keys remain untouched. Backups include the marker and all settings.

## Recovery and manual import

`words` is a recovery archive, not a synchronized second source of truth. Editing/deleting a converted note does not rewrite the original. Full backups include `legacyWords` alongside decks, notes, units, events, and settings. Site-data clearing removes both active data and archive; keep external copies.

The **Vocabulary JSON (original app)** import accepts original simple/full arrays, validates optional box/date fields, previews duplicates/invalid rows, and creates fresh Basic content with generated IDs. Old IDs are not reused. It deliberately resets scheduling and creates no historic events. This makes manual transfer from a different origin possible; automatic same-origin v1 upgrade retains usable state instead.

SmartRecall full backups restore additively after validation/confirmation. Same-ID differences block restore, protecting a newer collection. Export a full backup before moving an already upgraded collection between profiles/origins.

## Automated acceptance coverage

Tests build the actual v1 Dexie store in isolated fake IndexedDB databases, populate it, close it, then open SmartRecall v2. They cover empty upgrade, numeric/string ID distinction, exact text, duplicate-looking notes, raw extra/invalid values, useful due/box mapping, box-6 suspension, default deck creation, queue eligibility, reopening without duplicate conversion, and one-time preference import.

Separate storage tests exercise atomic review/import/restore rollback and durable quota accounting. Run `npm test`; these suites exercise Dexie's actual version upgrade, beyond merely testing a mapping helper. [BASELINE.md](BASELINE.md) records the verified starting point; [ARCHITECTURE.md](ARCHITECTURE.md) explains final stores and transactions.
