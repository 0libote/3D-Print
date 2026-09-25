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

Open `http://localhost:3000` and create the first account. That account is the owner and can add other people under **Team**. Everyone in a studio shares the same products, filaments and orders.

If port 3000 is in use, set `PRINTROOM_PORT`:

```bash
PRINTROOM_PORT=8080 docker compose up -d --build
```

The [container workflow](.github/workflows/container.yml) checks pull requests and publishes `ghcr.io/0libote/3d-print:latest` for each push to `main`, plus version tags for `v*` Git tags. It builds for AMD64 and ARM64. GitHub creates a new container package as private by default; after the first publish, the repository owner must change the package visibility to **Public** in its GitHub package settings for anonymous pulls. Until then, local builds work from this public repository.

The SQLite database and uploaded product images live in the Docker volume `printroom_data`. Keep this volume when updating the image. Back up the volume along with the rest of your server data. Put the app behind an HTTPS reverse proxy if accessing it outside your home network.

## How it works

1. Add the filaments you own, including a swatch colour.
2. Add products, upload an example image if you have one, and select the filaments offered for each product.
3. Create an order and add products with a quantity and optional filament.
4. Move the order through **New → Printing → Printed → Shipped**.

Order items retain their product name, price, filament name and colour when added. Editing or deleting a catalogue entry will not change an existing order. The dashboard shows your active queue and a seven day order chart.

The initial version uses GBP for prices. Product images are examples; the swatch shows the chosen filament colour, but does not recolour an uploaded image.

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

The UI uses React, Astryx with its stone theme, StyleX and TanStack Charts. Canvas UI effects and shadcn lint are intentionally absent: Canvas UI is an experimental visual effect library, while shadcn lint targets Tailwind projects; neither helps this StyleX based data entry app.
