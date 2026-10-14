import { Database } from "bun:sqlite";
import { orderCostEstimate } from "../shared/costs";
import { beforeAll, afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let dir: string,
  port: number,
  child: ReturnType<typeof Bun.spawn>,
  cookie: string;
async function request(
  path: string,
  method = "GET",
  value?: unknown,
  session = cookie,
) {
  return fetch(`http://localhost:${port}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: session || "" },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
}
async function api(path: string, method = "GET", value?: unknown) {
  const res = await request(path, method, value);
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}
const bootstrap = () => api("/bootstrap");
async function freshOrder(quantity = 2) {
  const { id } = await api("/orders", "POST", { customer: "Piece test" });
  await api(`/orders/${id}/items`, "POST", {
    product_id: 1,
    filament_id: 1,
    quantity,
  });
  await api(`/orders/${id}/confirm`, "POST", {});
  return (await bootstrap()).orders.find((o: any) => o.id === id);
}
const act = (p: any, action: string) =>
  request(`/pieces/${p.id}/action`, "POST", {
    action,
    version: p.version,
    printer: "Test printer",
  });
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "printroom-api-"));
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
  port = reservation.port!;
  reservation.stop(true);
  child = Bun.spawn([process.execPath, "run", resolve("server/index.ts")], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port) },
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await bootstrap()).needsSetup) break;
    } catch {}
    await Bun.sleep(50);
  }
  const response = await request("/setup", "POST", {
    name: "Owner",
    username: "owner",
    password: "password",
  });
  expect(response.status).toBe(201);
  cookie = response.headers.get("set-cookie")!.split(";")[0];
  const defaults = (await bootstrap()).settings;
  for (const key of [
    "production_tools",
    "material_tracking",
    "cost_reporting",
    "sales_tools",
  ])
    expect(defaults[key]).toBe(false);
  await api("/settings", "PUT", {
    currency: "GBP",
    show_money: true,
    production_tools: true,
    material_tracking: true,
    cost_reporting: true,
    sales_tools: true,
  });
  await api("/filaments", "POST", {
    name: "Red",
    color: "#ff0000",
    material: "PLA",
    spool_count: 2,
  });
  await api("/products", "POST", {
    name: "Widget",
    price: 10,
    filament_ids: [1],
    grams_per_piece: 10,
    minutes_per_piece: 30,
    revision: "v1",
  });
}, 10000);
afterAll(async () => {
  child?.kill();
  if (child) await child.exited;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("two identical ordered pieces have separate queued records", async () => {
  const order = await freshOrder();
  expect(order.items[0].pieces.map((p: any) => p.status)).toEqual([
    "queued",
    "queued",
  ]);
  expect(new Set(order.items[0].pieces.map((p: any) => p.id)).size).toBe(2);
});
test("concurrent starts permit only one active piece across orders", async () => {
  const a = await freshOrder(),
    b = await freshOrder();
  const p = a.items[0].pieces[0],
    q = b.items[0].pieces[0];
  const responses = await Promise.all([act(p, "start"), act(q, "start")]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  const data = await bootstrap();
  const active = data.orders
    .flatMap((o: any) => o.items.flatMap((i: any) => i.pieces))
    .filter((p: any) => p.status === "printing");
  expect(active).toHaveLength(1);
  expect((await act(active[0], "stop")).status).toBe(200);
});
test("partial completion exposes one printed piece and one queued sibling; shipping does not block printing", async () => {
  let order = await freshOrder(),
    piece = order.items[0].pieces[0];
  expect((await act(piece, "start")).status).toBe(200);
  order = (await bootstrap()).orders.find((o: any) => o.id === order.id);
  piece = order.items[0].pieces[0];
  expect((await act(piece, "complete")).status).toBe(200);
  order = (await bootstrap()).orders.find((o: any) => o.id === order.id);
  expect(order.items[0].printed_quantity).toBe(1);
  expect(order.items[0].pieces.map((p: any) => p.status)).toEqual([
    "printed",
    "queued",
  ]);
  expect((await act(order.items[0].pieces[0], "ship")).status).toBe(200);
  expect((await act(order.items[0].pieces[1], "start")).status).toBe(200);
  order = (await bootstrap()).orders.find((o: any) => o.id === order.id);
  expect((await act(order.items[0].pieces[1], "stop")).status).toBe(200);
});
test("failed print records attempt, consumes material and requeues only that piece", async () => {
  const before = (await bootstrap()).filaments[0].remaining_grams;
  let order = await freshOrder();
  await act(order.items[0].pieces[0], "start");
  order = (await bootstrap()).orders.find((o: any) => o.id === order.id);
  expect((await act(order.items[0].pieces[0], "fail")).status).toBe(200);
  const data = await bootstrap();
  expect(data.jobs[0].status).toBe("failed");
  expect(data.filaments[0].remaining_grams).toBe(before - 10);
  expect(
    data.orders
      .find((o: any) => o.id === order.id)
      .items[0].pieces.map((p: any) => p.status),
  ).toEqual(["queued", "queued"]);
});
test("duplicate and stale piece actions cannot record extra progress", async () => {
  let order = await freshOrder();
  const piece = order.items[0].pieces[0];
  await act(piece, "start");
  expect((await act(piece, "start")).status).toBe(409);
  order = (await bootstrap()).orders.find((o: any) => o.id === order.id);
  const printing = order.items[0].pieces[0];
  await act(printing, "complete");
  expect((await act(printing, "complete")).status).toBe(409);
  expect((await act(order.items[0].pieces[1], "ship")).status).toBe(409);
});
test("draft edits and piece endpoints reject fulfillment before confirmation", async () => {
  const { id } = await api("/orders", "POST", { customer: "Draft" });
  await api(`/orders/${id}/items`, "POST", { product_id: 1, quantity: 2 });
  const order = (await bootstrap()).orders.find((o: any) => o.id === id),
    item = order.items[0];
  expect(
    (
      await request(`/items/${item.id}`, "PUT", {
        ...item,
        printed_quantity: 2,
        shipped_quantity: 2,
      })
    ).status,
  ).toBe(409);
  expect((await act(item.pieces[0], "start")).status).toBe(409);
  await api(`/orders/${id}/confirm`, "POST", {});
  const confirmed = (await bootstrap()).orders.find((o: any) => o.id === id);
  expect(confirmed.status).toBe("new");
  expect(confirmed.items[0].printed_quantity).toBe(0);
});
test("quantity corrections preserve snapshots after catalogue rename and deletion", async () => {
  await api("/products", "POST", {
    name: "Historical",
    price: 7,
    filament_ids: [1],
    revision: "old",
  });
  let data = await bootstrap();
  const product = data.products[0];
  const { id } = await api("/orders", "POST", { customer: "History" });
  await api(`/orders/${id}/items`, "POST", {
    product_id: product.id,
    filament_id: 1,
    quantity: 2,
  });
  await api(`/products/${product.id}`, "PUT", {
    ...product,
    name: "Renamed",
    price: 20,
    revision: "new",
  });
  let item = (await bootstrap()).orders.find((o: any) => o.id === id).items[0];
  await api(`/items/${item.id}`, "PUT", { ...item, quantity: 3 });
  item = (await bootstrap()).orders.find((o: any) => o.id === id).items[0];
  expect(item.product_name).toBe("Historical");
  expect(item.unit_price).toBe(7);
  expect(item.revision).toBe("old");
  await api(`/products/${product.id}`, "DELETE");
  item = (await bootstrap()).orders.find((o: any) => o.id === id).items[0];
  await api(`/items/${item.id}`, "PUT", { ...item, quantity: 4 });
  item = (await bootstrap()).orders.find((o: any) => o.id === id).items[0];
  expect(item.product_name).toBe("Historical");
  expect(item.quantity).toBe(4);
});
test("atomic stock deltas do not lose simultaneous updates", async () => {
  const before = (await bootstrap()).filaments[0];
  const results = await Promise.all([
    request("/filaments/1/stock", "PUT", { delta: 1 }),
    request("/filaments/1/stock", "PUT", { delta: 1 }),
  ]);
  expect(results.every((r) => r.ok)).toBe(true);
  const after = (await bootstrap()).filaments[0];
  expect(after.spool_count).toBe(before.spool_count + 2);
  expect(after.remaining_grams).toBe(before.remaining_grams + 2000);
});
test("stale catalogue edits return conflicts", async () => {
  const product = (await bootstrap()).products.find((p: any) => p.id === 1);
  await api("/products/1", "PUT", { ...product, name: "Widget updated" });
  expect((await request("/products/1", "PUT", product)).status).toBe(409);
});
test("shipments roll back completely when a selected piece is not printed", async () => {
  let order = await freshOrder();
  await act(order.items[0].pieces[0], "start");
  order = (await bootstrap()).orders.find((o: any) => o.id === order.id);
  await act(order.items[0].pieces[0], "complete");
  order = (await bootstrap()).orders.find((o: any) => o.id === order.id);
  expect(
    (
      await request(`/orders/${order.id}/shipments`, "POST", {
        piece_ids: order.items[0].pieces.map((p: any) => p.id),
      })
    ).status,
  ).toBe(409);
  order = (await bootstrap()).orders.find((o: any) => o.id === order.id);
  expect(order.items[0].shipped_quantity).toBe(0);
  expect(order.shipments).toHaveLength(0);
  await api(`/orders/${order.id}/shipments`, "POST", {
    piece_ids: [order.items[0].pieces[0].id],
    carrier: "Royal Mail",
    tracking: "TEST",
  });
  order = (await bootstrap()).orders.find((o: any) => o.id === order.id);
  expect(order.items[0].shipped_quantity).toBe(1);
  expect(order.shipments[0].tracking).toBe("TEST");
});
test("cancelled orders keep history, block printing and can be restored", async () => {
  let order = await freshOrder();
  await api(`/orders/${order.id}/lifecycle`, "POST", {
    action: "cancel",
    version: order.version,
  });
  expect((await act(order.items[0].pieces[0], "start")).status).toBe(409);
  expect((await request(`/orders/${order.id}`, "DELETE")).status).toBe(409);
  order = (await bootstrap()).orders.find((o: any) => o.id === order.id);
  expect(order.status).toBe("cancelled");
  await api(`/orders/${order.id}/lifecycle`, "POST", {
    action: "restore",
    version: order.version,
  });
  expect((await api(`/orders/${order.id}/activity`)).length).toBeGreaterThan(2);
});
test("invalid bodies, references and unsafe push subscriptions return explicit errors", async () => {
  expect((await request("/products", "POST", null)).status).toBe(400);
  expect(
    (
      await request("/products", "POST", {
        name: "Bad",
        filament_ids: [999999],
      })
    ).status,
  ).toBe(404);
  expect((await request("/products/99999", "DELETE")).status).toBe(404);
  expect(
    (
      await request("/push-subscriptions", "POST", {
        subscription: {
          endpoint: "https://localhost/private",
          keys: { p256dh: "bad", auth: "bad" },
        },
      })
    ).status,
  ).toBe(400);
});
test("members cannot administer workspace and can change their own password", async () => {
  await api("/users", "POST", {
    name: "Member",
    username: "member",
    password: "original",
  });
  const login = await request(
    "/login",
    "POST",
    { username: "member", password: "original" },
    "",
  );
  const session = login.headers.get("set-cookie")!.split(";")[0];
  expect(
    (
      await request(
        "/settings",
        "PUT",
        { currency: "USD", show_money: true },
        session,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request(
        "/account/password",
        "PUT",
        { current_password: "original", password: "replacement" },
        session,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await request("/users", "POST", {
        name: "Empty",
        username: "empty",
        password: "",
      })
    ).status,
  ).toBe(400);
});
test("health and missing assets have proper responses", async () => {
  expect((await fetch(`http://localhost:${port}/healthz`)).status).toBe(200);
  expect(
    (await fetch(`http://localhost:${port}/assets/missing.js`)).status,
  ).toBe(404);
});

test("piece corrections keep the identity of an out-of-order completed piece", async () => {
  let order = await freshOrder(3);
  await act(order.items[0].pieces[1], "start");
  order = (await bootstrap()).orders.find((o: any) => o.id === order.id);
  await act(order.items[0].pieces[1], "complete");
  order = (await bootstrap()).orders.find((o: any) => o.id === order.id);
  const item = order.items[0],
    completedId = item.pieces[1].id;
  await api(`/items/${item.id}`, "PUT", { ...item, quantity: 4 });
  order = (await bootstrap()).orders.find((o: any) => o.id === order.id);
  expect(
    order.items[0].pieces.find((p: any) => p.id === completedId).status,
  ).toBe("printed");
  expect(order.items[0].pieces[0].status).toBe("queued");
});
test("actual material weights replace estimates in stock and job costs", async () => {
  const before = (await bootstrap()).filaments[0].remaining_grams;
  let order = await freshOrder();
  await act(order.items[0].pieces[0], "start");
  order = (await bootstrap()).orders.find((o: any) => o.id === order.id);
  const piece = order.items[0].pieces[0];
  await api(`/pieces/${piece.id}/action`, "POST", {
    action: "complete",
    version: piece.version,
    actual_grams: 3,
  });
  const data = await bootstrap();
  expect(data.filaments[0].remaining_grams).toBe(before - 3);
  expect(data.jobs[0].actual_grams).toBe(3);
  expect(data.jobs[0].estimated_grams).toBe(10);
});
test("archived catalogue entries cannot be added to new orders and can be restored", async () => {
  await api("/products", "POST", { name: "Archive test" });
  const product = (await bootstrap()).products[0];
  await api(`/products/${product.id}`, "DELETE");
  const { id } = await api("/orders", "POST", { customer: "Archive test" });
  expect(
    (
      await request(`/orders/${id}/items`, "POST", {
        product_id: product.id,
        quantity: 1,
      })
    ).status,
  ).toBe(400);
  const archived = (await bootstrap()).products.find(
    (p: any) => p.id === product.id,
  );
  expect(archived.archived).toBe(1);
  await api(`/products/${product.id}/restore`, "POST", {
    version: archived.version,
  });
  await api(`/orders/${id}/items`, "POST", {
    product_id: product.id,
    quantity: 1,
  });
});
test("order pagination keeps filters and exports independent of bootstrap history", async () => {
  for (let n = 0; n < 55; n++)
    await api("/orders", "POST", { customer: `Pagination ${n}` });
  const first = await api("/orders?filter=draft&q=Pagination");
  expect(first.orders).toHaveLength(50);
  expect(first.total).toBe(55);
  const next = await api(
    `/orders?filter=draft&q=Pagination&before=${first.next}`,
  );
  expect(next.orders).toHaveLength(5);
  expect(
    new Set([...first.orders, ...next.orders].map((o: any) => o.id)).size,
  ).toBe(55);
});

test("invalid filament weights do not leave partially created stock", async () => {
  const before = (await bootstrap()).filaments.length;
  const response = await request("/filaments", "POST", {
    name: "Invalid stock",
    material: "PLA",
    color: "#ff0000",
    spool_count: 1,
    grams_per_spool: 1000,
    remaining_grams: -1,
    cost_per_kg: 20,
  });
  expect(response.status).toBe(400);
  expect((await bootstrap()).filaments.length).toBe(before);
});

test("production costs retain order rates and count failed attempts", async () => {
  await api("/settings", "PUT", {
    show_money: true,
    currency: "GBP",
    machine_hourly_rate: 3,
    electricity_per_kwh: 0.3,
    printer_watts: 200,
  });
  const product = (await bootstrap()).products.find((p: any) => p.id === 1);
  await api("/products/1", "PUT", {
    ...product,
    grams_per_piece: 50,
    minutes_per_piece: 60,
  });
  const order = await freshOrder(1);
  await api("/settings", "PUT", {
    show_money: true,
    currency: "USD",
    machine_hourly_rate: 30,
    electricity_per_kwh: 3,
    printer_watts: 2000,
  });
  expect(order.machine_hourly_rate).toBe(3);
  const estimate = orderCostEstimate(order);
  expect(estimate.machine).toBe(3);
  expect(estimate.energy).toBeCloseTo(0.06);
  expect((await act(order.items[0].pieces[0], "start")).status).toBe(200);
  const db = new Database(join(dir, "printroom.sqlite"));
  db.query(
    "UPDATE print_jobs SET started_at=datetime('now','-1 hour') WHERE status='running'",
  ).run();
  db.close();
  let current = (await bootstrap()).orders.find((o: any) => o.id === order.id);
  expect((await act(current.items[0].pieces[0], "fail")).status).toBe(200);
  const data = await bootstrap();
  current = data.orders.find((o: any) => o.id === order.id);
  const job = data.jobs.find((j: any) => j.order_id === order.id);
  expect(job.machine_cost).toBeCloseTo(3, 2);
  expect(job.energy_cost).toBeCloseTo(0.06, 2);
  expect(job.actual_minutes).toBeCloseTo(60, 1);
  expect(job.currency).toBe("GBP");
  expect(current.actual_cost).toBeCloseTo(
    job.machine_cost + job.energy_cost + job.material_cost,
  );
  expect(current.items[0].pieces[0].status).toBe("queued");
  const invalid = await request("/settings", "PUT", {
    show_money: true,
    currency: "GBP",
    machine_hourly_rate: -1,
  });
  expect(invalid.status).toBe(400);
  expect((await bootstrap()).settings.currency).toBe("USD");
});

test("basic mode ignores material limits and preserves optional data", async () => {
  await api("/settings", "PUT", {
    currency: "GBP",
    show_money: true,
    production_tools: false,
    material_tracking: false,
    cost_reporting: false,
    sales_tools: false,
  });
  const filament = (await bootstrap()).filaments.find((f: any) => f.id === 1);
  await api("/filaments/1", "PUT", { ...filament, remaining_grams: 0 });
  const order = await freshOrder(1);
  expect(order.machine_hourly_rate).toBe(0);
  expect((await act(order.items[0].pieces[0], "start")).status).toBe(200);
  let data = await bootstrap();
  const piece = data.orders.find((o: any) => o.id === order.id).items[0]
    .pieces[0];
  expect((await act(piece, "complete")).status).toBe(200);
  data = await bootstrap();
  expect(data.filaments.find((f: any) => f.id === 1).remaining_grams).toBe(0);
  expect(
    data.products.find((p: any) => p.id === 1).grams_per_piece,
  ).toBeGreaterThan(0);
  expect(
    data.jobs.find((j: any) => j.order_id === order.id).material_cost,
  ).toBe(0);
  expect(data.settings.machine_hourly_rate).toBe(30);
  const invalid = await request("/settings", "PUT", {
    currency: "GBP",
    show_money: true,
    material_tracking: "true",
  });
  expect(invalid.status).toBe(400);
});

test("quantity-only edits preserve material cost", async () => {
  await api("/settings", "PUT", {
    currency: "GBP",
    show_money: true,
    production_tools: true,
    material_tracking: true,
    cost_reporting: true,
    sales_tools: true,
  });
  await api("/filaments", "POST", {
    name: "Costed",
    color: "#00ff00",
    material: "PLA",
    spool_count: 2,
    grams_per_spool: 1000,
    remaining_grams: 2000,
    cost_per_kg: 30,
  });
  const filaments = (await bootstrap()).filaments;
  const costed = filaments.find((f: any) => f.name === "Costed");
  await api("/products", "POST", {
    name: "Costed widget",
    price: 12,
    filament_ids: [costed.id],
    grams_per_piece: 10,
    minutes_per_piece: 30,
    revision: "v1",
  });
  const product = (await bootstrap()).products.find(
    (p: any) => p.name === "Costed widget",
  );
  const { id } = await api("/orders", "POST", { customer: "Cost test" });
  await api(`/orders/${id}/items`, "POST", {
    product_id: product.id,
    filament_id: costed.id,
    quantity: 2,
  });
  let item = (await bootstrap()).orders.find((o: any) => o.id === id).items[0];
  expect(item.cost_per_kg).toBe(30);
  const res = await request(`/items/${item.id}`, "PUT", {
    quantity: 3,
    printed_quantity: 0,
    shipped_quantity: 0,
    version: item.version,
  });
  expect(res.status).toBe(200);
  item = (await bootstrap()).orders.find((o: any) => o.id === id).items[0];
  expect(item.quantity).toBe(3);
  expect(item.cost_per_kg).toBe(30);
  expect(item.product_name).toBe("Costed widget");
});

test("double confirmation is rejected", async () => {
  const { id } = await api("/orders", "POST", { customer: "Double confirm" });
  await api(`/orders/${id}/items`, "POST", { product_id: 1, quantity: 1 });
  expect((await request(`/orders/${id}/confirm`, "POST", {})).status).toBe(200);
  expect((await request(`/orders/${id}/confirm`, "POST", {})).status).toBe(409);
});

test("concurrent confirmations confirm only once", async () => {
  const { id } = await api("/orders", "POST", { customer: "Race confirm" });
  await api(`/orders/${id}/items`, "POST", { product_id: 1, quantity: 1 });
  const responses = await Promise.all([
    request(`/orders/${id}/confirm`, "POST", {}),
    request(`/orders/${id}/confirm`, "POST", {}),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  const order = (await bootstrap()).orders.find((o: any) => o.id === id);
  expect(order.status).toBe("new");
});

test("cancelled orders reject edits", async () => {
  const { id } = await api("/orders", "POST", { customer: "Cancel guard" });
  await api(`/orders/${id}/items`, "POST", { product_id: 1, quantity: 1 });
  await api(`/orders/${id}/confirm`, "POST", {});
  let order = (await bootstrap()).orders.find((o: any) => o.id === id);
  await api(`/orders/${id}/lifecycle`, "POST", {
    action: "cancel",
    version: order.version,
  });
  order = (await bootstrap()).orders.find((o: any) => o.id === id);
  expect(order.status).toBe("cancelled");
  expect(
    (
      await request(`/orders/${id}`, "PUT", {
        customer: "Mutated",
        contact: "",
        notes: "",
        ship_by: "",
        version: order.version,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request(`/orders/${id}/items`, "POST", {
        product_id: 1,
        quantity: 1,
      })
    ).status,
  ).toBe(409);
});

test("concurrent filament consumption cannot drive stock negative", async () => {
  await api("/settings", "PUT", {
    currency: "GBP",
    show_money: true,
    production_tools: true,
    material_tracking: true,
    cost_reporting: true,
    sales_tools: true,
  });
  await api("/filaments", "POST", {
    name: "Race",
    color: "#0000ff",
    material: "PLA",
    spool_count: 1,
    grams_per_spool: 1000,
    remaining_grams: 20,
    cost_per_kg: 10,
  });
  const filament = (await bootstrap()).filaments.find(
    (f: any) => f.name === "Race",
  );
  await api("/products", "POST", {
    name: "Race widget",
    price: 5,
    filament_ids: [filament.id],
    grams_per_piece: 10,
    minutes_per_piece: 5,
    revision: "v1",
  });
  const product = (await bootstrap()).products.find(
    (p: any) => p.name === "Race widget",
  );
  const { id } = await api("/orders", "POST", { customer: "Race" });
  await api(`/orders/${id}/items`, "POST", {
    product_id: product.id,
    filament_id: filament.id,
    quantity: 2,
  });
  await api(`/orders/${id}/confirm`, "POST", {});
  let order = (await bootstrap()).orders.find((o: any) => o.id === id);
  expect((await act(order.items[0].pieces[0], "start")).status).toBe(200);
  order = (await bootstrap()).orders.find((o: any) => o.id === id);
  expect((await act(order.items[0].pieces[0], "complete")).status).toBe(200);
  let stock = (await bootstrap()).filaments.find(
    (f: any) => f.id === filament.id,
  );
  expect(stock.remaining_grams).toBe(10);
  expect((await act(order.items[0].pieces[1], "start")).status).toBe(200);
  order = (await bootstrap()).orders.find((o: any) => o.id === id);
  const running = order.items[0].pieces[1];
  const current = (await bootstrap()).filaments.find(
    (f: any) => f.id === filament.id,
  );
  await api(`/filaments/${filament.id}`, "PUT", {
    ...current,
    remaining_grams: 5,
  });
  const complete = await request(`/pieces/${running.id}/action`, "POST", {
    action: "complete",
    version: running.version,
    printer: "Test printer",
  });
  expect(complete.status).toBe(409);
  stock = (await bootstrap()).filaments.find((f: any) => f.id === filament.id);
  expect(stock.remaining_grams).toBe(5);
  expect(stock.remaining_grams).toBeGreaterThanOrEqual(0);
  order = (await bootstrap()).orders.find((o: any) => o.id === id);
  expect((await act(order.items[0].pieces[1], "stop")).status).toBe(200);
});
