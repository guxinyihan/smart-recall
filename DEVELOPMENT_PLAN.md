# SmartRecall development plan

## Verified upstream and foundation

Full Git clone of https://github.com/alised/flashcard_react; HEAD is exactly the audited `181ca58acc93238dc1b9192f04b33d4fa561a5af`. All 28 upstream commits are available, clone is not shallow. No intervening upstream differences. LICENSE retains Copyright (c) 2024 Ali Sed.

Inherited: React 19, TypeScript 5.7, Vite 6, Tailwind 3, Dexie 4, browser routing, context state, light/dark theme, vocabulary CRUD/search, six-box Leitner scheduling, daily-new setting, learning sessions, keyboard shortcuts, JSON vocabulary import/export, VitePWA configuration and icons. These will be extended, not claimed as entirely new work.

## Source audit before implementation

- Entry: `src/main.tsx` → `src/App.tsx`. Routes `/learn`, `/database`, `/words`, `/settings`, `/help`, root redirects to Learn. No existing hooks folder or automated tests.
- Source of truth: `flashcardDB` v1 `words: ++id, word, box, nextReview` and a context memory copy. `WordsContext.tsx` owns types, scheduling, CRUD, import/export, quota calculation, and errors.
- Scheduler uses implicit current dates, box intervals 1/2/4/7/14 days; box 6 is permanently excluded. No historical review event collection.
- Theme/new-limit/auto-answer stored under localStorage `darkMode`, `dailyNewWords`, `autoShowAnswer`.
- Confirmed swallowed write failures: updateWordBox, setWordAsMastered, deleteWord/deleteAllWords resolve after console-only catches. Learn awaits them then advances its session.
- Confirmed quota defect: only current box-2 cards last reviewed today count; failed new introductions do not count. Zero daily limit bypasses limiting.
- Import checks truthy word/context only, trusts box/date values, deduplicates against existing data but not incoming batch. Export excludes settings/history and is not a full backup.
- Learn shortcuts intercept editable fields, and Space submits success after revealing. Modal divs lack dialog semantics/focus handling; icon close, search and theme checkbox lack accessible names; narrow navigation can overflow.
- VitePWA already exists: autoUpdate, app icons, font runtime cache; includeAssets names do not exist; separate public manifest duplicates configuration; no explicit update UI.
- Baseline package manager is npm (README; committed npm lockfile, no engines). Current environment Node 24.18.0 / npm 11.16.0. Node 24 LTS will be explicitly supported. Installation/build/lint results will be recorded in `docs/BASELINE.md` without hiding failures.

## Proposed architecture

Pure TypeScript domain modules for typed notes, cloze, four-rating SM-2-style scheduling, deterministic queue and event analytics. Separate scheduling units: Basic one direction, Reverse two, Cloze one per distinct deletion ID. Dexie database with repositories/services; React coordinates loading, mutation feedback and rendered views. Keep a small local application with no backend or mandatory AI. Use existing React/router/Dexie/PWA/Tailwind where useful.

## Migration and safety

Keep the exact database name and declare upstream version 1 before an explicit version 2 upgrade. Retain original words table as a legacy archive; create default Imported Vocabulary deck and convert records preserving IDs, text and usable dates/box intervals. Invalid legacy scheduling maps conservatively with documented decisions; original raw record remains available. No fabricated review history. Box 6 maps to suspended units rather than scientific mastery. Settings migrate once into IndexedDB; localStorage remains untouched for recovery. Fresh databases initialize settings/deck through the database layer. Tests use isolated fake IndexedDB names and actual v1 schema upgrades; reopening cannot re-run conversion.

Review writes update scheduling units and append immutable events in one transaction; failures propagate and leave the UI on the same card. Quotas use persisted introductions (including Again) and review events, apply in write transactions, and use an explicit IANA study timezone. Archive decks by default; deletion blocked for populated decks. Preserve historical events when deleting notes. Imports require preview, strict validation and explicit confirmation; confirmed batches transact atomically. Backup restore uses safe additive merge with no silent overwrites unless a fully tested replace workflow is implemented.

## Milestones and commits

1. Audit, baseline, reproducible lockfile and characterization tests.
2. Typed domain, tested cloze/scheduler/queues/analytics.
3. Versioned storage, data-preserving migration and transaction tests.
4. Deck/card services, strict notes/CSV/full backup workflows and validation tests.
5. Incremental replacement of context-heavy screens with dashboard/decks/cards/study/analytics/import/settings; preserve theme, CRUD, search and keyboard workflows.
6. Accessible native dialogs, responsive views, failure feedback, explicit PWA update prompt and offline verification.
7. Focused workflow tests, independent review, real browser acceptance and screenshots, README, CI and release hygiene.
8. Publish a new unused public repository only after local release gates pass; verify pushed SHA and hosted Actions; final factual report.

Tests accompany each feature. Commits reflect actual development, retain all upstream history, and never rewrite original authorship.

## Test plan and acceptance criteria

Vitest + React Testing Library + fake-indexeddb. Controlled timestamps throughout domain/database tests. Scheduler first/rating/lapse/bounds/determinism; cloze valid/multiple/repeated/invalid; queues states/limits/reload/timezone/day rollover; analytics empty/count/distribution/streak; migration empty/populated/mixed/invalid/duplicates/ID preservation/reopen; review and import rollback; safe deletion; backup invalid references/dates/IDs/tags and roundtrip. Workflow tests use role/label queries for deck and all note types, reveal/rating/keyboard, filters, previews and failed-save feedback.

Final gates: clean install, lint, all tests, TypeScript/Vite/PWA build, migration/import transaction safety, keyboard/modal accessibility, no secrets or unwanted generated files, exact LICENSE preservation, truthful documentation and actual screenshots. Browser acceptance creates Operating Systems cards, studies all ratings, reloads, filters tags, exports/imports, archives/restores and verifies production service worker offline startup. Only claim checks actually run. Hosted CI status is separate from local checks.

## Risks and boundaries

Legacy v1 has no creation timestamps or immutable history: infer creation time only from plausible timestamp IDs, otherwise migration time; never invent analytics. Origin changes cannot access old IndexedDB automatically; users must export/import from the original origin. IndexedDB can be cleared by browser/user; backups remain necessary. Student-sized collections load in memory; document scalability. Service workers require localhost or HTTPS and are tested against production preview. GitHub CLI currently has invalid credentials while connector profile identifies guxinyihan; publication must verify working credentials and will not overwrite any existing repository. Existing user proxy is used only per command, never committed into configuration.
