# Printroom

A small, self hosted hub for a 3D print studio. Keep a product catalogue, the filament colours you offer, and orders from request through printing and shipping.

## Run with Docker

Use the published image:

```bash
curl -O https://raw.githubusercontent.com/0libote/3D-Print/main/compose.image.yml
docker compose -f compose.image.yml up -d
```

Or clone this repository and build the image locally:

```bash
docker compose up -d --build
```

Open `http://localhost:3000` and create the first account with a username and password. Email is not required. New and reset passwords must be nonempty and no longer than 1024 characters. That account is the owner and can add other people under **Team**. Existing users can sign in with their old email or their new username (based on their display name). Everyone in a studio shares the same products, filaments and orders.

The owner can change any team member's password or delete their account from **Team**. Changing a password signs out that person's other sessions; deleting an account removes its sessions and push subscriptions while keeping shared orders and products. The owner cannot delete their own account.

If port 3000 is in use, set `PRINTROOM_PORT`:

```bash
PRINTROOM_PORT=8080 docker compose up -d --build
```

`PRINTROOM_PORT` is the host port only (`8080:3000` in this example). The container keeps listening on `PORT=3000`; other Compose services connect to `http://printroom:3000`. The Compose files include optional backup mounts and a companion service waiting for `service_healthy`.

The [container workflow](.github/workflows/container.yml) checks pull requests and pushes to `main` (tests, `bun run format:check`, frontend build and a production container smoke test) and publishes `ghcr.io/0libote/3d-print:latest` for each push to `main` only after checks pass, plus version tags for `v*` Git tags. It builds for AMD64 and ARM64. The published `latest` image has been verified to pull anonymously.

The SQLite database, spool images, product images, and Web Push keys live in the Docker volume `printroom_data`. Keep this volume when updating the image. Use the verified backup/restore commands below before upgrades. Put the app behind an HTTPS reverse proxy for access outside localhost; HTTPS is required for PWA installation and push notifications on devices.

## How it works

1. Add the filaments you own, including a swatch colour, optional spool photo, spool count and approximate grams per spool. Track remaining grams and material cost per kilogram. The + and − buttons adjust spools atomically; printing consumes actual grams, or the product estimate when no actual weight is entered.
2. Add products, upload an example image if you have one, and select the filaments offered for each product. Add grams, print minutes, revision/variant, print profile and an external STL/3MF link.
3. Create a draft order, optionally set its **Ship by** date, and add products with a quantity and optional filament.
4. Confirm the draft sale when it is ready to fulfill. It enters the print queue only after confirmation.
5. Each ordered unit becomes a separate physical piece: quantity 2 produces two queue entries. **Start** one piece, then **Complete**, **Fail**, or **Stop** it. Only one print can run across the studio, including simultaneous requests from different devices. A failed attempt records its material use and returns that piece to the queue. Completion leaves its siblings queued.
6. Dispatch printed pieces individually or select a shipment batch with carrier/tracking. Download a printable packing slip. Corrections preserve completed piece identities and production snapshots; active prints must be stopped before editing.

Order details use a full-page view. Pieces still to print appear in the print queue, sorted by the nearest ship-by date. Printed pieces waiting for shipment appear in **Ready to ship**; a partially completed line can appear in both places. Deadlines appear in the order list and detail view, with due-today and overdue highlights. After 9 am in the server's `TZ` timezone, Printroom checks confirmed, unshipped orders every 15 minutes and creates one approaching reminder within two days of the ship-by date, then one overdue reminder if needed. The default timezone in the Compose files is `Europe/London`; set `TZ` to another IANA timezone for your studio. The light/dark preference stays in your browser. Existing orders from older versions remain confirmed sales when the database upgrades; their items inherit the order's former stage and piece counts.

Signed-in browsers receive changes from other users automatically. A live status appears in the top bar; the app also refreshes when you return to the tab and checks periodically if the live connection is interrupted.

Order items retain their product name, price, filament name and colour when added. Editing or archiving a catalogue entry will not change an existing order. Archived entries can be restored. Cancel or archive confirmed orders to retain their history; only drafts can be permanently deleted. The overview shows the active queue and recent orders. Each order also shows who changed it and when.

In **Settings**, an owner can hide all price and total displays or select a currency. Price data stays in the database when hidden. Product images are examples; the swatch shows the chosen filament colour, but does not recolour an uploaded image.

## Install and notifications

Printroom is installable as a PWA and has a mobile navigation bar. On iPhone or iPad, open the HTTPS address in Safari, tap **Share → Add to Home Screen**, then open Printroom from its Home Screen icon. On iOS 16.4 or later, open **Settings → Set up notifications** inside the installed app and allow notifications when asked. Each user can choose which events they receive: new drafts, confirmed sales, print stage changes, shipped orders, approaching deadlines and overdue deadlines. The **Send test** button checks delivery after setup. Push notifications need an internet connection to the device's push service and may not work on an isolated LAN.

## Development

Requires Bun 1.4.2. In separate terminals (use an isolated `DATA_DIR` so dev never touches real data):

```bash
bun install
DATA_DIR=./dev-data bun run server
```

```bash
bun run dev
```

Vite runs on port 5173 and proxies `/api` and `/uploads` requests to Bun on port 3000. The production image builds the frontend and serves it from Bun. Never share one data directory between environments; point each at its own `DATA_DIR`.

The UI uses React, Astryx with its stone theme, and StyleX. Canvas UI effects and shadcn lint are intentionally absent: Canvas UI is an experimental visual effect library, while shadcn lint targets Tailwind projects; neither helps this StyleX based data entry app.

## Studio tools

The overview shows remaining physical pieces, printer time estimates and material reservations/shortages. Print history records each attempt, operator, printer, elapsed time, estimated/actual grams and material cost. Payment state, shipment batches and order CSV export are available. Orders retain their sale currency when workspace settings change. Members can change their own password in Settings.

Order search and filters use paginated server queries. Order activity and print history can load older records. Live updates refresh immediately; polling resumes when the live connection drops. Installed apps offer a Reload action when an update is ready. Fonts are bundled for local use; offline order mutations are not supported.

## Backups and recovery

Stop Printroom before these maintenance operations so database and uploaded photos stay aligned. Keep backup folders outside DATA_DIR, preferably on another disk. These commands use the same Bun version as the app:

```bash
DATA_DIR=./data bun run backup /absolute/backups/printroom-2026-10-07
DATA_DIR=./restored-data bun run restore /absolute/backups/printroom-2026-10-07
```

Backup includes a consistent SQLite snapshot (including committed WAL data), uploads and push keys. Restore checks integrity and requires an empty destination. Keep the old data directory for rollback. Point the app at the restored directory and restart. Docker users can run the maintenance script with the stopped app's data volume and a separate mounted backup directory; the image contains `/app/scripts/maintenance.ts`.

The image runs as the `bun` user. The `chown` of `/app/data` in the Dockerfile applies at build time only, so it does not fix permissions on a freshly mounted volume: with a bind mount, make sure the host directory is writable by the container's `bun` user or SQLite will fail to open. Named volumes (as in the Compose files above) avoid this trap.

For a locked-out owner, stop the app, set `PRINTROOM_RECOVERY_PASSWORD` privately in the shell environment, then run:

```bash
DATA_DIR=./data bun run recover-owner owner-username
unset PRINTROOM_RECOVERY_PASSWORD
```

Recovery revokes that owner's sessions. Restart the app and sign in. To inspect unreferenced uploaded images older than 24 hours, run `bun run cleanup-uploads`; use `bun run cleanup-uploads --apply` while the app is stopped to remove them.

Upgrades apply numbered transactional migrations automatically. Existing completed/shipped counts become individual pieces. Old line-level Printing flags cannot identify a physical active piece, so unfinished pieces return to Queued; explicitly start the intended piece after upgrading. Back up before deployment.

## Verification

```bash
bun test
bun run build
bun run format:check
```

Tests cover individual pieces, simultaneous starts, stock consumption, snapshots, stale edits, permissions, transactional shipments, pagination, upgrade fixtures, upload cleanup and backup/recovery. They live in 7 files: `tests/api.test.ts`, `tests/api-path.test.ts`, `tests/maintenance.test.ts`, `tests/migrations.test.ts`, `tests/order-progress.test.ts`, `tests/service-worker.test.ts` and `tests/setup.test.ts`. `/healthz` provides the container health check.

Manual-only checks (not covered by `bun test`):

- Push delivery on a real device over HTTPS.
- Installed-app update flow (service worker upgrade with an already installed app).
- ARM runtime (CI builds AMD64 and ARM64 images, but automated tests run on AMD64).

## Production cost reporting

Set machine cost per hour, electricity price per kWh and average printer watts in workspace Settings. Rates default to zero and are copied to each new order, preserving historical assumptions and currency. Existing orders retain zero machine/energy rates because their original rates are unknown.

Order details show estimated material, machine and electricity costs plus estimated contribution (sale value minus those costs). Print history and order totals record material consumption and machine/energy costs for every finished attempt, including failures and stopped attempts. Machine and energy actuals use elapsed time between Start and Complete/Fail/Stop; finish the attempt promptly for useful figures. Running attempts are not yet included in recorded costs.

These are production contributions, not accounting profit: labour, shipping, tax and other expenses are excluded. Zero rates, missing product estimates and historical progress without print attempts leave costs incomplete. Currency changes do not convert catalogue prices or material costs; enter values in the workspace's current currency for new work.

## Basic mode and optional tools

New and upgraded workspaces start with optional tools **off**. The basic workflow remains products, filaments, orders, one-piece printing and shipping. In Settings an owner can independently enable production details/history, material planning/automatic consumption, production cost reporting, and payments/shipment tracking/packing slips.

Disabled tools hide their extra screens, panels and fields. Material tracking off means stock weight never blocks printing and no material is automatically consumed. Cost reporting off means new orders and print attempts receive no machine/energy rates. Turning tools off preserves existing estimates, costs, shipments and settings. Re-enable them to see the saved data. Recorded material cost requires material tracking; machine/energy costs can be used independently.

The container build runs independently of tests. Run the optional test stage with
`docker build --target test .`; CI runs tests separately and reports migration and
helper line coverage as an artifact alongside explicit backup/restore CLI tests.
The CLI runs in subprocesses, whose lines are not instrumented by Bun coverage. Typechecking has its own CI job. Container
smoke checks verify health, bootstrap, frontend HTML and the versioned service worker.

Order list counters use one grouped scan, independent of search and pagination.
Settings are fetched in one `WHERE key IN (...)` query. Bootstrap batches child
records and groups product/filament links in memory. Composite indexes support
order filters, item/shipments by order, job totals and activity by `(order_id,id DESC)`.
The UI already loads order history from `GET /api/orders/:id/activity`, with 50
entries per page and an exclusive positive integer `before` cursor; the bounded
bootstrap activity feed is for the studio overview. Contains searches still scan
names because a leading `%` cannot use a normal B-tree index.

The service worker cache ID hashes emitted file contents, public assets and the
worker template. The build fails if the worker or its version placeholder is
missing, and replaces every placeholder occurrence.
