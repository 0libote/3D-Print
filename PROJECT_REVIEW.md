# Printroom project review

Reviewed 7 October 2026. Scope: all tracked application code, shared logic, styles, PWA assets, tests, build configuration, container deployment and CI.

## Assessment

Printroom has a useful foundation: shared catalogue, filament stock, draft-to-confirmed orders, per-piece fulfillment, deadlines, activity, team management, live updates, push notifications and container delivery. Keep React, Bun and SQLite. The next release should focus on correctness and recovery before expanding the product.

Validation: all 5 existing tests passed and the production build passed. API reproductions used a separate temporary database; desktop overview and a 390px mobile order detail were inspected in the collaborative browser. No horizontal overflow appeared in that mobile view. This was not a full device, HTTPS/push, upgrade or Docker runtime test. The default `/usr/bin/bun` wrapper was broken locally; checks ran with `/home/oliver/.bun/bin/bun`. That is a local tooling issue, not an application failure.

## Fix first

### 1. Draft progress bypass and inconsistent confirmation — high, reproduced

Locations: `server/index.ts:452` (confirmation), `server/index.ts:529` (item edit), `src/main.tsx:240` (edit form).

The status and progress endpoints reject drafts, but the general item edit endpoint accepts nonzero printed/shipped counts on a draft. The form exposes these inputs too. A 3-piece draft can be edited to 3 printed/3 shipped. Confirmation then sets the order to `new` while the item remains `shipped`, leaving an active order with no work in either queue.

Change: reject nonzero progress for drafts on every write path; hide draft progress controls; confirm and derive aggregate status in one transaction. Define invariants centrally: `0 <= shipped <= printed <= quantity`, draft counts are zero, confirmed order status matches its items. Consider a one-time repair for existing inconsistent rows.

Acceptance: the reproduced draft cannot acquire progress; confirmation produces matching order/item stages; API tests cover both normal and bypass paths.

### 2. Historical snapshots change during ordinary item edits — high, reproduced

Locations: `server/index.ts:534-542`, `src/main.tsx:236-240`.

After renaming a product, editing only an order item's quantity rewrites its stored product name to the new catalogue name. Filament names/colours are also reread. Deleting the original product sets its reference to null; subsequent edits require a currently existing product, so progress/quantity corrections cannot preserve the original item. Removing an offered filament can likewise prevent unrelated edits.

Change: separate quantity/progress corrections from explicit product/filament replacement. Preserve stored snapshots when the reference is unchanged or deleted. Replacing an item should be an intentional operation with clear price/progress behavior. Prefer catalogue archival for entries used in orders.

Acceptance: rename, delete or change offered colours, then correct quantities/progress without replacing historic names, colours or prices.

### 3. Stock adjustments lose updates — high for shared use, reproduced

Locations: `src/main.tsx:159`, `server/index.ts:398-403`.

The +/− buttons send an absolute count calculated from browser state. Two clients adding one spool from a count of 2 both write 3; the correct result is 4. Other editable records also allow silent stale overwrites.

Change: an atomic stock delta endpoint with bounds checks, a stock movement history, and per-control pending states. Add version checks to full-record edits so stale forms return a conflict instead of overwriting newer work.

Acceptance: concurrent increments/decrements produce the correct bounded count; stale record edits get an actionable conflict.

### 4. Partial shipping behavior disagrees with documentation — medium, source confirmed

Locations: `src/main.tsx:107-109`, `README.md` fulfillment description.

The ready-to-ship list requires the entire line to be `printed`; the README says a partially printed line can appear in both queues. Order details already allow shipping any printed piece.

Change: for the documented per-piece workflow, use `printed_quantity > shipped_quantity` for shipping readiness and show remaining quantities in each queue. If whole-line shipping is intended, update the documentation and UI consistently instead.

Acceptance: a line with quantity 3, printed 1, shipped 0 is visible in both relevant queues under the per-piece policy.

### 5. Repeated fulfillment clicks can record unintended pieces — medium, source confirmed

Locations: `src/main.tsx:93-99`, `src/main.tsx:183-184`, `src/main.tsx:197`.

The app sets a global busy flag, but print/ship buttons and stage selectors do not use it. Rapid clicks can submit multiple valid increments before the UI refreshes. Overlapping actions also race to clear the flag.

Change: track pending mutations per item, disable conflicting controls, and make response ordering predictable. Add request deduplication if retries are introduced.

Acceptance: one pending action per item; slow network interaction does not accidentally record additional pieces.

## Reliability and access

### 6. Backups and restoration — high operational value

There is only a general README instruction to back up the volume. Add a documented, executable backup/restore process covering SQLite, uploads and push keys. Use a consistent SQLite backup or stop the app while copying the complete volume; do not instruct users to copy just the live main database file with WAL active. Verify restoration into a clean deployment and provide owner recovery steps. CSV export is useful but does not replace a backup.

### 7. Authentication and account lifecycle — medium/high depending on exposure

Locations: `server/index.ts:91-95`, `server/index.ts:276-329`, `src/main.tsx:66-76`, `src/main.tsx:251-326`.

Empty passwords are accepted intentionally and documented; there is no login throttling. Members cannot change their own password, so temporary passwords depend on owner intervention. Logout first removes and unsubscribes push; a failure there prevents the logout request. A local browser subscription can remain after account deletion or switch, while Settings decides it is enabled solely from the browser subscription.

Change: require a nonempty password for new/reset credentials, bound credential input and throttle login/setup hashing; add member self-service password changes. Always complete session logout even when push cleanup fails. Reconcile the current device subscription with the current server user. Clean expired sessions; track authenticated SSE connections so revoked accounts can have their live streams closed.

Also review push endpoint validation before broader deployment: any signed-in member can currently store an arbitrary HTTPS endpoint that the server later contacts. Restrict unsafe destinations and validate key format. This is a code-observed outbound request surface; no exploit was attempted.

### 8. Error contracts, uploads and mutations — medium

Locations: `server/index.ts:162-164`, `server/index.ts:390-435`, `server/index.ts:554-556`.

Some catalogue updates/deletes return success for nonexistent IDs. Product filament IDs rely on database errors rather than explicit validation. JSON null is accepted by the parser and fails later. All caught errors, including internal failures, become 400 responses with raw messages. Upload validation trusts declared MIME type; removed/replaced/unattached images are never reclaimed. Static uploads are publicly retrievable by their URL.

Change: typed request validation, consistent 404/409 responses, safe 500 responses with useful server logs, file signature/decoding checks and upload cleanup. Decide whether photos should require authentication. Keep data changes and their activity entries transactional.

## UI and maintainability

### 9. Accessible dialogs and navigation — medium, browser/source confirmed

Locations: `src/main.tsx:164`, `src/main.tsx:212`, `index.html:2`.

Dialogs have no dialog role, aria-modal, focus containment/restoration or Escape handler. Opening the item editor left focus on the background Edit button in the browser check. Order table rows are click-only rather than keyboard links/buttons. The viewport disables zoom.

Change: a shared accessible dialog component, keyboard-operable order links, meaningful error announcements and restored zoom. Check touch targets, long names and both themes. Preserve the existing visual style.

### 10. Scale data loading and keep complete order history — medium

Locations: `server/index.ts:191-203`, `server/index.ts:261`, `src/main.tsx:65-88`, `src/main.tsx:156`.

Every bootstrap loads every order/item/product and executes per-record queries. It repeats after mutations and every 30 seconds even with SSE connected. Order detail history is filtered from only the latest 100 global events, so an older order's history disappears from the UI as the studio gets busier.

Change: dedicated paginated order/catalogue endpoints, indexed queries, order-specific activity fetching and scoped refreshes. Poll as a fallback; maintain reconnect reconciliation. Add search/filtering to products and filaments. Measure with a realistic larger database before optimizing further.

### 11. Tests and code boundaries — high enabling value

Locations: `tests/`, `tsconfig.json`, `server/index.ts`, `src/main.tsx`.

There are 5 tests: 4 small progress helper tests and 1 setup race integration test. The TypeScript configuration excludes server/shared/tests, so the passing build does not type-check the backend. Backend data/API values use pervasive any types. The server and UI are each concentrated in one file, with very long JSX lines and repeated style overrides.

Change: add API regression tests for the reproduced bugs, permissions/session revocation, missing references, concurrent progress/stock and upgrade fixtures. Type-check the backend with Bun and web-push types. Extract shared DTOs/validation and domain logic, numbered transactional migrations, API routes, page components and common form/dialog controls. Consolidate CSS after behavior is covered. Remove unused chart dependencies/styles if confirmed unused.

### 12. Deployment and PWA updates — medium

Locations: `Dockerfile`, `compose.yml`, `.github/workflows/container.yml`, `public/sw.js`.

Good foundations: non-root runtime, persistent volume, frozen lockfile, tests/build in the image, multi-architecture publishing and pinned Actions. Add a health endpoint/container health check, graceful shutdown and a deployment/restore smoke test. Pin the Bun version across development/CI/images for reproducibility.

The service worker uses a fixed cache name with cache-first assets and immediate activation; older assets can accumulate and upgrade behavior is not tested. Add release-specific shell caches and an update flow tested with an already installed app. Missing static asset paths currently fall back to index.html; return 404 for asset requests. Test push permission, delivery, subscription recovery and updates on real HTTPS devices. Use self-hosted fonts if isolated-LAN operation matters.

## Build next: proposed product backlog

These are opportunities, not defects. Prioritize based on the studio's actual work.

1. **Print jobs and batches.** Group multiple order pieces into a build plate/job; record printer, operator, estimated/actual duration, start/completion and failed pieces/reprints. Keep job lifecycle separate from fulfillment counts. Begin with manual job tracking; add printer integrations once the model is stable.
2. **Material planning.** Product/variant grams per piece, actual remaining spool grams, reservations for confirmed work, low-stock alerts and job consumption. Spool count alone cannot tell whether the queue can be printed. Multi-material requirements can follow single-material planning.
3. **Order lifecycle and dispatch.** Cancellation/archive rather than permanent deletion, shipment batches, carrier/tracking and packing slips. Add payment state/deposits if sales administration happens here. An empty confirmed order currently remains active; define explicit cancellation behavior.
4. **Reusable product production details.** STL/3MF attachment or external link, revision, print profile, expected duration and product variants. Snapshot the relevant revision into orders/jobs.
5. **Operational overview.** Show overdue work, pieces remaining, ready pieces, active jobs and material shortages. Current metrics mix order counts and line counts; label the units explicitly. Add estimated capacity only after job estimates exist.
6. **Cost and margin.** Material/unit costs, time/energy assumptions and estimates versus actuals. If currencies can change after sales exist, store currency with each order; the current global setting relabels historical numeric prices without conversion.

## Recommended delivery sequence

1. **Correctness release:** findings 1–5, focused API regression tests, historical-reference-safe edits and updated workflow docs.
2. **Reliability release:** backup/restore and owner recovery, account lifecycle, accessible dialogs, backend type checking, migrations and health checks.
3. **Studio workflow release:** manual print jobs/batches and material requirements/reservations.
4. **Growth release:** archive/dispatch/export, paginated data/history, production attachments and cost reporting.

Complete one release at a time. The first release is the best immediate return: it protects order and stock accuracy using the existing product model.

## Implementation status after this review

Implemented the correctness and reliability fixes, per-piece production queue with one active print, attempt history, actual material consumption and planning, production metadata snapshots, cancellation/archive/restore, payment state, shipment batches/tracking, printable packing slips, CSV export, paginated orders and history, shared accessible dialogs, backend type checking, transactional migrations, verified maintenance tools, health checks and controlled PWA updates. The regression suite now contains 28 tests.

The larger product ideas remain separate extensions: printer integrations, build plates containing multiple pieces (the current studio deliberately prints one piece at a time), multi-material recipes, native production-file uploads and accounting-grade margin reporting. Catalogue paging and splitting every API route/page into its own module remain scaling/refactoring work. Costing now records material, machine time and energy with order rate snapshots and estimated/recorded production contribution; current production files use external links. Real-device push and installed-app update verification requires the deployed HTTPS studio.

Advanced studio tools are now independently opt-in and default off, with basic-mode stock/printing behavior covered by regression tests.
