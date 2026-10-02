# SmartRecall release report

Verified on 2026-10-02. Implementation revision: `503bd468522df990c525f35c080c9a4ed6133fcc`. This report was written after implementation, local acceptance, clean-clone checks, publication, and the implementation's hosted CI run succeeded.

## 1. Upstream repository

[alised/flashcard_react](https://github.com/alised/flashcard_react) was cloned with full Git history, rather than downloaded as a ZIP. The original repository remains the `upstream` remote.

## 2. Audited upstream commit

`181ca58acc93238dc1b9192f04b33d4fa561a5af` was present and was the actual upstream HEAD at inspection. No newer upstream changes required adjustment. All 28 original commits remain ancestors of SmartRecall's main branch. The clone is not shallow.

## 3. Final repository

[guxinyihan/smart-recall](https://github.com/guxinyihan/smart-recall), public, default branch `main`. The new personal repository is `origin`.

## 4. License and attribution

The MIT [LICENSE](LICENSE) is byte-identical to upstream, including **Copyright (c) 2024 Ali Sed**. Its Git blob is `0d364c9b2c48fdd607f6127eb10e21753d46a7ba`. README explicitly credits the original application and distinguishes inherited foundations from additions. Original commits and authorship were preserved.

## 5. Inherited functionality

React 19, TypeScript, Vite, Tailwind, Dexie/IndexedDB, context state, routes, vocabulary CRUD/search, themes, learning sessions, keyboard shortcuts, daily-new preferences, JSON vocabulary import/export, Leitner scheduling, and Vite PWA configuration already existed. SmartRecall extends or replaces these implementations; it does not claim to have introduced their underlying technologies.

## 6. SmartRecall functionality added

Deck management; typed Basic, Reverse, and Cloze notes; independent scheduling units; a four-rating scheduler; immutable review events; durable daily quotas; tags and filters; deterministic notes parsing; CSV import/export; complete JSON backups and additive restore; an explicit data-preserving v2 migration; event analytics; accessible responsive workflows; explicit PWA updates; automated tests and CI. There is no mandatory backend or AI service.

## 7. Confirmed problems fixed

The source audit confirmed the oversized WordsContext, box-based quota accounting that missed failed introductions and bypassed zero limits, swallowed write errors followed by session advancement, insufficient import validation and same-batch duplicate handling, incomplete exports, modal/shortcut accessibility defects, and inconsistent PWA assets/update configuration. These paths were replaced with separated domain/services, persisted-event accounting, atomic transactions, validated previews, full backups, guarded shortcuts, and explicit update handling.

Verification also found and fixed stale note snapshots after direction removal/recreation, preference restore contrary to a preview, native dialog opening/Tab focus behavior, accidental repeated-Space rating, and array-coerced backup direction/rating fields. Regression cases reproduced the relevant failures before the fixes.

## 8. Final architecture

Pure domain modules own card/cloze, scheduling, queue, analytics, and parsing rules. Dexie owns schema/upgrades/snapshots; services validate and transact mutations. AppProvider initializes storage and observes `liveQuery`; pages own temporary filters, dialogs, and sessions. Error boundaries and storage-startup feedback provide visible recovery without clearing data. [Architecture](docs/ARCHITECTURE.md) records routes and boundaries.

## 9. Final Dexie schema

Database name remains `flashcardDB`. Version 2 declares:

| Store      | Key and indexes                                             |
| ---------- | ----------------------------------------------------------- |
| `words`    | `++id, word, box, nextReview` — original recovery archive   |
| `decks`    | `id, name, archivedAt`                                      |
| `cards`    | `id, deckId, type, *tags, updatedAt`                        |
| `units`    | `id, cardId, deckId, due, state, [deckId+due]`              |
| `events`   | `id, unitId, cardId, deckId, timestamp, [deckId+timestamp]` |
| `settings` | `id`, one `app` row                                         |

## 10. Legacy migration

Dexie's actual v1→v2 upgrade transaction creates Imported Vocabulary for populated databases, preserves exact numeric/string IDs and useful content/dates, maps box intervals, and suspends box 6. Invalid fields receive conservative documented fallbacks while original raw records remain in `words`. No historical review events are fabricated. Reopening does not duplicate conversion. localStorage preferences migrate once into IndexedDB without deleting their original keys. Same origin/profile is required; [Migration](docs/MIGRATION.md) details approximations and different-origin content transfer.

## 11. Card type model

`Card` means a user-created note. Basic has one forward unit; Reverse has independently scheduled forward/reverse units; Cloze has one unit per distinct positive marker ID. Repeated IDs hide together and optional hints are supported. Numeric `1` and string `"1"` remain distinct. Matching units retain schedules on edits; removed directions retain history only, and new directions start fresh. Monotonic note/unit revisions reject stale submissions.

## 12. Scheduling algorithm

The pure SM-2-inspired scheduler receives an explicit timestamp. Default ease is 2.5, bounded to 1.3–3.0. Again retries after one minute, reduces ease by 0.20, resets repetitions, and adds a lapse only to graduated review units. Learning Hard retries after five minutes; review Hard uses `round(I × 1.2)` and ease −0.15. Good graduates at one day; in review state it uses six days when prior repetitions are at most one, otherwise `round(max(I + 1, I × E))`. Easy graduates at four days or uses `round(max(I + 1, I × E × 1.3))`, with ease +0.15. Intervals are bounded. These are application rules, not a scientific superiority claim; [README](README.md#spaced-repetition) explains differences from canonical SM-2.

## 13. Review queue semantics

Only due active units in unarchived decks qualify. Order is Learning, Overdue, Due, New, then due time, note creation, and stable ID. Calendar categories use the chosen IANA study zone; interval days are elapsed 24-hour periods. Global quotas count distinct introduced/existing units from persisted events. A first Again consumes a new place; retries do not charge another place. Failed transactions consume none. Zero limits, reload/reopen, timezone changes, and day rollover have controlled-clock coverage.

## 14. Review events

Each committed rating appends an immutable event with note/unit/deck IDs, timestamp, rating, previous/next state, interval, ease and due time, introduction flag, and response duration. Schedule and event write atomically after revision, eligibility, and quota rechecks. Failure leaves the current answer/progress visible. Events survive note deletion. Populated deck deletion is blocked; archive retains data.

## 15. Import/export safety

Notes, CSV, and original vocabulary JSON are parsed and previewed before confirmation. Counts include invalid rows, duplicates, new notes, and decks. Skip/keep-both policies apply to existing and incoming duplicates. Confirmed batches recheck current data and transact atomically. Manual vocabulary JSON import creates fresh Basic notes and schedules, unlike automatic v1 migration.

Full JSON includes metadata, decks, notes, units, events, settings, and raw legacy records. Strict validation rejects malformed types, IDs, dates, references, tags, scheduler values, and array-coerced enums. Additive restore skips identical records and blocks changed same-ID conflicts. Preferences restore only when both preview and current destination allow it. No destructive replacement mode is exposed. Failure rolls back all added records.

## 16. Analytics definitions

Reviews count saved events, including repeats. Introductions count distinct first-rated units per study day. Streaks use consecutive calendar dates through today or yesterday. Rating average maps Again/Hard/Good/Easy to 1/2/3/4. Non-Again percentage is `(Hard + Good + Easy) / all recorded ratings × 100`, over all stored history, and is explicitly self-reported outcomes rather than retention. The 30-day calendar and deck activity derive from events. Empty data has no invented activity or ratios. Local session summaries contain saved ratings and elapsed time; measured durations can include idle time.

## 17. Offline/PWA verification

Production build generated a coherent manifest, actual local icons, `sw.js`, Workbox, and 25 precache entries. Real Chrome tests checked manifest/icon files, loaded and created data online, closed an isolated persistent browser, restarted it offline, navigated directly to a route, reviewed a card, and verified persistence/quota after reload. Another test changed only an isolated copy of the production service worker and verified that a waiting update required explicit acceptance. There are no normal-study remote API calls. Native OS-level PWA installation was not manually exercised; initial cache completion on HTTPS/localhost remains required.

## 18. Accessibility improvements

Semantic controls, associated labels, named close buttons, visible focus, status/error feedback, skip link, route focus, native modal semantics, post-opening input focus, Tab/Shift+Tab boundary cycling, Escape cancellation, and trigger restoration. Study shortcuts ignore editable fields/dialogs/modifiers/repeats and require reveal by default. Browser acceptance verified actual dialog focus behavior and keyboard ratings. Responsive checks covered deck pages, editors, study, analytics, and import previews at 1440, 768, and 390-pixel viewport widths. No universal browser/screen-reader conformance is claimed.

## 19. Automated test results

| Check                             | Actual final implementation result                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| Clean-clone `npm ci`              | Exit 0; 620 packages added, 621 audited, 0 reported vulnerabilities                              |
| `npm run lint`                    | Exit 0                                                                                           |
| `npm test`                        | 97 passed, 10 files; no failures                                                                 |
| `npm run build`                   | Exit 0; TypeScript, Vite, and PWA generation succeeded                                           |
| `npm run test:e2e`                | 5 passed in real Chrome against production assets                                                |
| Formatting and `git diff --check` | Passed                                                                                           |
| Release hygiene                   | Credential-pattern scan found no matches; no environment/dependency/build/test artifacts tracked |
| License/history                   | Exact LICENSE blob and upstream ancestry verified                                                |

Tests include actual isolated v1 Dexie upgrades, mixed IDs/boxes/invalid legacy fields/reopening, deterministic scheduling/queues/timezones, persisted review quotas, stale edits/concurrency, atomic review/import/restore failure, malformed backups, cloze, analytics, and critical role/label-based component workflows. Two malformed-enum cases failed before the final validation fix and passed after it. Pattern scanning and dependency audit results are bounded checks, not an exhaustive security guarantee.

## 20. Manual acceptance-test results

No human manual acceptance session is claimed. The requested product workflow was executed by automated real-browser actions, and the resulting screenshots were visually inspected. All of these scenarios passed:

| Scenario                                                                   | Verified outcome                                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Operating Systems deck + fork Basic, process/进程 Reverse, semaphore Cloze | Created 3 notes / 4 units                                         |
| Reveal and all four ratings, keyboard and buttons                          | 4 immutable events, 75% non-Again outcome                         |
| Reload                                                                     | Notes/history/schedules retained; 4/4 new quota persisted         |
| Second deck, tag/type/deck filters                                         | Correct note counts and global quota enforcement                  |
| JSON and CSV exports                                                       | Actual downloads parsed and inspected                             |
| CSV duplicates and notes invalid/duplicate preview                         | Counts correct; explicit confirmation; 1 valid new note persisted |
| Fresh-context full restore                                                 | Notes, units, events, and settings matched exported data          |
| Archive/unarchive                                                          | Deck state changed and restored; populated deletion blocked       |
| Offline cold restart/review and v1 migration/study                         | Passed in isolated real browser profiles                          |

Six real production screenshots are committed under `screenshots/smartrecall-*.png` and referenced in README. Their data belongs to test collections, not fabricated default analytics.

## 21. CI results

Hosted [SmartRecall quality checks run 36996261580](https://github.com/guxinyihan/smart-recall/actions/runs/36996261580) completed with **success** on implementation SHA `503bd468522df990c525f35c080c9a4ed6133fcc`. The actual Ubuntu/Node 24 job passed checkout, setup, `npm ci`, lint, all Vitest tests, and production build. Browser E2E is separately verified locally; the hosted workflow runs the documented core checks. This report is a subsequent documentation commit; its hosted run is checked again before task completion.

## 22. Known limitations

Data is local to origin/profile; there is no sync, cloud recovery, encryption layer, or shared-deck backend. Browser clearing/eviction can remove records, so external backups matter. Legacy history cannot be reconstructed; migration approximations are documented. Collection/history snapshots and array scans suit personal collections; larger histories need pagination/aggregation. Sessions snapshot the queue and do not persist transient UI; due learning retries return through the next queue. Restore deliberately blocks changed same-ID records rather than resolving conflicts automatically. Offline behavior depends on completed caching and browser storage. MCQ, optional secure AI, sync, and broader assistive-technology coverage remain roadmap items.

## 23. Node/browser assumptions

Supported Node is 24.x, recorded in `engines` and `.nvmrc`. Local verification used Node 24.18.0 / npm 11.16.0 on Windows and Google Chrome 154.0.8037.93. Hosted checks used Ubuntu with Node 24. A modern browser needs IndexedDB, IANA `Intl` support, native dialogs, and service workers for offline assets. Viewport tests do not constitute physical-device testing.

## 24. Exact development commands

```bash
git clone https://github.com/guxinyihan/smart-recall.git
cd smart-recall
npm ci
npm run dev
```

Development uses port 4000. Quality commands are `npm run lint`, `npm test`, `npm run test:watch`, and `npm run format:check`. Browser acceptance requires a production build and installed Google Chrome; run `npm run test:e2e`. If Chrome is unavailable, follow README's Playwright browser instructions. Network/cache overrides used in this execution were machine-specific and are not committed project requirements. A second full clone from the published GitHub URL and its clean installation succeeded.

## 25. Exact production commands

```bash
npm ci
npm run build
npm run preview
```

Deploy generated `dist` at a site root with an `index.html` fallback; use HTTPS for service workers outside localhost. This task published source to GitHub, not a separate hosted application. Subdirectory deployment needs coordinated path configuration changes.

## 26. Commit summary

These logical SmartRecall milestones follow the preserved upstream history:

| Commit    | Change                                                        |
| --------- | ------------------------------------------------------------- |
| `795977d` | Audit, development plan, and recorded baseline                |
| `91c65c8` | Typed domain and deterministic study algorithms               |
| `54ddef8` | Legacy storage preservation and transactional reviews/imports |
| `5394b54` | Accessible deck/card/study/backup product workflows           |
| `74eb948` | Native dialog opening focus and keyboard boundaries           |
| `97f2b07` | Production offline/browser acceptance and CI                  |
| `1b0b9d9` | Architecture/migration documentation and real screenshots     |
| `503bd46` | Strict enum validation and reproduced regression fixes        |

The final report is committed afterward as release evidence. Original Git history was not replaced with a new initial commit, force-pushed, or rewritten.

## 27. Publication result

The authenticated owner was verified as `guxinyihan`. The requested repository name was verified unused, and a new **public** repository was created without overwriting another repository. The pushed main SHA was independently read back from GitHub and matched the implementation revision above. Public cloning succeeded and retained upstream ancestry. Requested React/TypeScript/flashcards/spaced-repetition/education/IndexedDB/Dexie/PWA/Vite/offline-first topics were set. Hosted CI success was inspected before writing this report; final documentation is pushed and its CI verified before completion.
