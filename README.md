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

Open `http://localhost:3000` and create the first account with a username and password. Email is not required, and passwords can be any length. That account is the owner and can add other people under **Team**. Existing users can sign in with their old email or their new username (based on their display name). Everyone in a studio shares the same products, filaments and orders.

The owner can change any team member's password or delete their account from **Team**. Changing a password signs out that person's other sessions; deleting an account removes its sessions and push subscriptions while keeping shared orders and products. The owner cannot delete their own account.

If port 3000 is in use, set `PRINTROOM_PORT`:

```bash
PRINTROOM_PORT=8080 docker compose up -d --build
```

The [container workflow](.github/workflows/container.yml) checks pull requests and publishes `ghcr.io/0libote/3d-print:latest` for each push to `main`, plus version tags for `v*` Git tags. It builds for AMD64 and ARM64. The published `latest` image has been verified to pull anonymously.

The SQLite database, spool images, product images, and Web Push keys live in the Docker volume `printroom_data`. Keep this volume when updating the image. Back up the volume along with the rest of your server data. Put the app behind an HTTPS reverse proxy for access outside localhost; HTTPS is required for PWA installation and push notifications on devices.

## How it works

1. Add the filaments you own, including a swatch colour, optional spool photo, spool count and approximate grams per spool. Adjust stock manually with the + and − buttons.
2. Add products, upload an example image if you have one, and select the filaments offered for each product.
3. Create a draft order, optionally set its **Ship by** date, and add products with a quantity and optional filament.
4. Confirm the draft sale when it is ready to fulfill. It enters the print queue only after confirmation.
5. Use **Print one** and **Ship one** to track each piece in a line. Edit an item to correct its quantity, filament or progress. The stage dropdown moves the entire line at once; moving it back to Queued or Printing resets its piece counts. The order status follows its items.

Order details use a full-page view. Pieces still to print appear in the print queue, sorted by the nearest ship-by date. Printed pieces waiting for shipment appear in **Ready to ship**; a partially completed line can appear in both places. Deadlines appear in the order list and detail view, with due-today and overdue highlights. After 9 am in the server's `TZ` timezone, Printroom checks confirmed, unshipped orders every 15 minutes and creates one approaching reminder within two days of the ship-by date, then one overdue reminder if needed. The default timezone in the Compose files is `Europe/London`; set `TZ` to another IANA timezone for your studio. The light/dark preference stays in your browser. Existing orders from older versions remain confirmed sales when the database upgrades; their items inherit the order's former stage and piece counts.

Signed-in browsers receive changes from other users automatically. A live status appears in the top bar; the app also refreshes when you return to the tab and checks periodically if the live connection is interrupted.

Order items retain their product name, price, filament name and colour when added. Editing or deleting a catalogue entry will not change an existing order. The overview shows the active queue and recent orders. Each order also shows who changed it and when.

In **Settings**, an owner can hide all price and total displays or select a currency. Price data stays in the database when hidden. Product images are examples; the swatch shows the chosen filament colour, but does not recolour an uploaded image.

## Install and notifications

Printroom is installable as a PWA and has a mobile navigation bar. On iPhone or iPad, open the HTTPS address in Safari, tap **Share → Add to Home Screen**, then open Printroom from its Home Screen icon. On iOS 16.4 or later, open **Settings → Set up notifications** inside the installed app and allow notifications when asked. Each user can choose which events they receive: new drafts, confirmed sales, print stage changes, shipped orders, approaching deadlines and overdue deadlines. The **Send test** button checks delivery after setup. Push notifications need an internet connection to the device's push service and may not work on an isolated LAN.

## Development

Requires Bun. In separate terminals:

```bash
bun install
bun run server
```

```bash
bun run dev
```

Vite runs on port 5173 and proxies API requests to Bun on port 3000. The production image builds the frontend and serves it from Bun.

The UI uses React, Astryx with its stone theme, and StyleX. Canvas UI effects and shadcn lint are intentionally absent: Canvas UI is an experimental visual effect library, while shadcn lint targets Tailwind projects; neither helps this StyleX based data entry app.
