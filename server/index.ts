import { featureDefaults } from "../shared/features";
import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import webpush from "web-push";
import { orderStatus } from "../shared/order-progress.ts";
import { migrateProduction } from "./migrations";
import { production, RequestError } from "./production";
import {
  validatePushSubscription,
  imageExtension,
  positiveNumber,
  productionDetails,
} from "./validation";

const dataDir = process.env.DATA_DIR || "./data";
const uploadDir = join(dataDir, "uploads");
mkdirSync(uploadDir, { recursive: true });
const db = new Database(join(dataDir, "printroom.sqlite"), { create: true });
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS filaments (id INTEGER PRIMARY KEY, name TEXT NOT NULL, brand TEXT NOT NULL DEFAULT '', material TEXT NOT NULL DEFAULT 'PLA', color TEXT NOT NULL DEFAULT '#adb5bd', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '', price REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS product_filaments (product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, filament_id INTEGER NOT NULL REFERENCES filaments(id) ON DELETE CASCADE, PRIMARY KEY (product_id, filament_id));
CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, customer TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','printing','printed','shipped')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id INTEGER REFERENCES products(id) ON DELETE SET NULL, product_name TEXT NOT NULL, filament_id INTEGER REFERENCES filaments(id) ON DELETE SET NULL, filament_name TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '#adb5bd', quantity INTEGER NOT NULL CHECK(quantity > 0), unit_price REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notification_preferences (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, draft_created INTEGER NOT NULL DEFAULT 0, sale_confirmed INTEGER NOT NULL DEFAULT 1, print_stage INTEGER NOT NULL DEFAULT 1, order_shipped INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, subscription_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activity_events (id INTEGER PRIMARY KEY, actor_id INTEGER, actor_name TEXT NOT NULL, order_id INTEGER, kind TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS activity_order_idx ON activity_events(order_id,id DESC);
CREATE TABLE IF NOT EXISTS deadline_reminders (order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, kind TEXT NOT NULL, ship_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(order_id,kind,ship_by));
`);
if (
  !db
    .query("PRAGMA table_info(users)")
    .all()
    .some((column: any) => column.name === "is_admin")
)
  db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
if (
  db.query("SELECT id FROM users LIMIT 1").get() &&
  !db.query("SELECT id FROM users WHERE is_admin=1 LIMIT 1").get()
)
  db.exec("UPDATE users SET is_admin=1 WHERE id=(SELECT MIN(id) FROM users)");
if (
  !db
    .query("PRAGMA table_info(orders)")
    .all()
    .some((column: any) => column.name === "is_draft")
) {
  db.exec("ALTER TABLE orders ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0");
}
if (
  !db
    .query("PRAGMA table_info(orders)")
    .all()
    .some((column: any) => column.name === "confirmed_at")
) {
  db.exec("ALTER TABLE orders ADD COLUMN confirmed_at TEXT");
}
if (
  !db
    .query("PRAGMA table_info(orders)")
    .all()
    .some((column: any) => column.name === "ship_by")
) {
  db.exec("ALTER TABLE orders ADD COLUMN ship_by TEXT NOT NULL DEFAULT ''");
}
if (
  !db
    .query("PRAGMA table_info(order_items)")
    .all()
    .some((column: any) => column.name === "status")
) {
  db.exec(
    "ALTER TABLE order_items ADD COLUMN status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','printing','printed','shipped'))",
  );
  db.exec(
    "UPDATE order_items SET status=(SELECT CASE orders.status WHEN 'new' THEN 'queued' ELSE orders.status END FROM orders WHERE orders.id=order_items.order_id)",
  );
}
if (
  !db
    .query("PRAGMA table_info(order_items)")
    .all()
    .some((column: any) => column.name === "printed_quantity")
) {
  db.exec(
    "ALTER TABLE order_items ADD COLUMN printed_quantity INTEGER NOT NULL DEFAULT 0",
  );
  db.exec(
    "UPDATE order_items SET printed_quantity=quantity WHERE status IN ('printed','shipped')",
  );
}
if (
  !db
    .query("PRAGMA table_info(order_items)")
    .all()
    .some((column: any) => column.name === "shipped_quantity")
) {
  db.exec(
    "ALTER TABLE order_items ADD COLUMN shipped_quantity INTEGER NOT NULL DEFAULT 0",
  );
  db.exec(
    "UPDATE order_items SET shipped_quantity=quantity WHERE status='shipped'",
  );
}
for (const column of [
  "deadline_soon INTEGER NOT NULL DEFAULT 1",
  "deadline_overdue INTEGER NOT NULL DEFAULT 1",
]) {
  const name = column.split(" ")[0];
  if (
    !(
      db.query("PRAGMA table_info(notification_preferences)").all() as {
        name: string;
      }[]
    ).some((field) => field.name === name)
  )
    db.exec(`ALTER TABLE notification_preferences ADD COLUMN ${column}`);
}
if (
  !db
    .query("PRAGMA table_info(users)")
    .all()
    .some((column: any) => column.name === "username")
) {
  db.exec("ALTER TABLE users ADD COLUMN username TEXT");
}
for (const user of db
  .query("SELECT id,name FROM users WHERE username IS NULL")
  .all() as { id: number; name: string }[]) {
  const base =
    user.name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "user";
  let username = base,
    suffix = 2;
  while (
    db
      .query("SELECT id FROM users WHERE username=? COLLATE NOCASE")
      .get(username)
  )
    username = `${base}-${suffix++}`;
  db.query("UPDATE users SET username=? WHERE id=?").run(username, user.id);
}
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(username COLLATE NOCASE)",
);
for (const column of [
  "image_url TEXT NOT NULL DEFAULT ''",
  "spool_count INTEGER NOT NULL DEFAULT 0",
  "grams_per_spool REAL NOT NULL DEFAULT 1000",
]) {
  const name = column.split(" ")[0];
  if (
    !(
      db.query("PRAGMA table_info(filaments)").all() as { name: string }[]
    ).some((field) => field.name === name)
  )
    db.exec(`ALTER TABLE filaments ADD COLUMN ${column}`);
}
db.query(
  "INSERT OR IGNORE INTO app_settings (key,value) VALUES ('show_money','true'),('currency','GBP')",
).run();
migrateProduction(db);
const workshop = production(db);
type Row = Record<string, any>;
const all = (sql: string, ...params: any[]) =>
  db.query(sql).all(...params) as Row[];
const one = (sql: string, ...params: any[]) =>
  db.query(sql).get(...params) as Row | null;
const run = (sql: string, ...params: any[]) => db.query(sql).run(...params);
const json = (value: unknown, status = 200) => Response.json(value, { status });
const bad = (message: string, status = 400) => json({ error: message }, status);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const hashPassword = async (password: unknown) => {
  if (
    typeof password !== "string" ||
    !password.length ||
    password.length > 1024
  )
    throw new RequestError("Password must contain 1 to 1,024 characters");
  return "v2$" + (await Bun.password.hash("printroom-v2:" + password));
};
async function verifyPassword(password: string, stored: string) {
  if (stored.startsWith("v2$"))
    return Bun.password.verify("printroom-v2:" + password, stored.slice(3));
  return Bun.password.verify(password, stored);
}
let vapidPublic = one("SELECT value FROM app_settings WHERE key='vapid_public'")
  ?.value as string | undefined;
let vapidPrivate = one(
  "SELECT value FROM app_settings WHERE key='vapid_private'",
)?.value as string | undefined;
if (!vapidPublic || !vapidPrivate) {
  const keys = webpush.generateVAPIDKeys();
  vapidPublic = keys.publicKey;
  vapidPrivate = keys.privateKey;
  run(
    "INSERT OR REPLACE INTO app_settings (key,value) VALUES ('vapid_public',?),('vapid_private',?)",
    vapidPublic,
    vapidPrivate,
  );
}
webpush.setVapidDetails(
  "https://github.com/0libote/3D-Print",
  vapidPublic,
  vapidPrivate,
);
type NoticeKind =
  | "draft_created"
  | "sale_confirmed"
  | "print_stage"
  | "order_shipped"
  | "deadline_soon"
  | "deadline_overdue";
const noticeKinds: NoticeKind[] = [
  "draft_created",
  "sale_confirmed",
  "print_stage",
  "order_shipped",
  "deadline_soon",
  "deadline_overdue",
];
function settings() {
  return {
    ...(Object.fromEntries(
      Object.keys(featureDefaults).map((key) => [
        key,
        one("SELECT value FROM app_settings WHERE key=?", key)?.value ===
          "true",
      ]),
    ) as typeof featureDefaults),
    machine_hourly_rate: Number(
      one("SELECT value FROM app_settings WHERE key='machine_hourly_rate'")
        ?.value || 0,
    ),
    electricity_per_kwh: Number(
      one("SELECT value FROM app_settings WHERE key='electricity_per_kwh'")
        ?.value || 0,
    ),
    printer_watts: Number(
      one("SELECT value FROM app_settings WHERE key='printer_watts'")?.value ||
        0,
    ),
    show_money:
      one("SELECT value FROM app_settings WHERE key='show_money'")?.value !==
      "false",
    currency:
      one("SELECT value FROM app_settings WHERE key='currency'")?.value ||
      "GBP",
  };
}
function preferences(userId: number) {
  run(
    "INSERT OR IGNORE INTO notification_preferences (user_id) VALUES (?)",
    userId,
  );
  return one(
    `SELECT ${noticeKinds.join(",")} FROM notification_preferences WHERE user_id=?`,
    userId,
  );
}
function activity(
  actor: Row | null,
  orderId: number | null,
  kind: string,
  detail: string,
) {
  run(
    "INSERT INTO activity_events (actor_id,actor_name,order_id,kind,detail) VALUES (?,?,?,?,?)",
    actor?.id ?? null,
    actor?.name ?? "Printroom",
    orderId,
    kind,
    detail,
  );
}
async function sendNotice(
  kind: NoticeKind,
  title: string,
  message: string,
  orderId?: number,
  onlyUserId?: number,
) {
  const subscribers = all(
    `SELECT ps.endpoint,ps.subscription_json FROM push_subscriptions ps JOIN notification_preferences np ON np.user_id=ps.user_id WHERE np.${kind}=1${onlyUserId ? " AND ps.user_id=?" : ""}`,
    ...(onlyUserId ? [onlyUserId] : []),
  );
  await Promise.all(
    subscribers.map(async (subscriber) => {
      try {
        await webpush.sendNotification(
          JSON.parse(subscriber.subscription_json),
          JSON.stringify({
            title,
            body: message,
            url: orderId ? `/?order=${orderId}` : "/",
          }),
          { TTL: 3600, urgency: "normal" },
        );
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410)
          run(
            "DELETE FROM push_subscriptions WHERE endpoint=?",
            subscriber.endpoint,
          );
        else console.error("Push delivery failed:", error?.message || error);
      }
    }),
  );
}
function notify(
  kind: NoticeKind,
  title: string,
  message: string,
  orderId?: number,
) {
  void sendNotice(kind, title, message, orderId).catch((error) =>
    console.error("Notification failed:", error),
  );
}
function cookie(req: Request, token: string, maxAge: number) {
  const secure =
    new URL(req.url).protocol === "https:" ||
    req.headers.get("x-forwarded-proto") === "https";
  return `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
function userFrom(req: Request) {
  const token = req.headers
    .get("cookie")
    ?.match(/(?:^|; )session=([^;]+)/)?.[1];
  if (!token) return null;
  return one(
    "SELECT users.id, users.name, users.username, users.is_admin FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>datetime('now')",
    hash(token),
  );
}
function username(value: unknown) {
  const text = required(value, "Username", 64);
  if (!/^[a-zA-Z0-9._-]+$/.test(text))
    throw new RequestError(
      "Username can contain letters, numbers, dots, underscores and hyphens",
    );
  return text;
}
async function body(req: Request): Promise<Row> {
  try {
    const value = await req.json();
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new RequestError("Invalid object");
    return value as Row;
  } catch {
    throw new RequestError("Send a JSON object");
  }
}
function required(value: unknown, label: string, limit = 200) {
  const text = String(value ?? "").trim();
  if (!text || text.length > limit)
    throw new RequestError(`${label} is required (max ${limit} characters)`);
  return text;
}
function optional(value: unknown, limit = 2000) {
  const text = String(value ?? "").trim();
  if (text.length > limit)
    throw new RequestError(`Text is too long (max ${limit} characters)`);
  return text;
}
function shipBy(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
    !Number.isFinite(Date.parse(text)) ||
    new Date(text).toISOString().slice(0, 10) !== text
  )
    throw new RequestError("Choose a valid ship-by date");
  return text;
}
function id(value: string | undefined) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new RequestError("Invalid ID");
  return n;
}
function filamentStock(b: Row) {
  const count = Number(b.spool_count ?? 0),
    grams = Number(b.grams_per_spool ?? 1000);
  if (!Number.isSafeInteger(count) || count < 0 || count > 100000)
    throw new RequestError(
      "Spool count must be a whole number between 0 and 100,000",
    );
  if (!Number.isFinite(grams) || grams < 0 || grams > 100000)
    throw new RequestError("Grams per spool must be between 0 and 100,000");
  return { count, grams };
}
function productRows() {
  const links = all("SELECT * FROM product_filaments");
  return all("SELECT * FROM products ORDER BY id DESC").map((p) => ({
    ...p,
    filament_ids: links
      .filter((l) => l.product_id === p.id)
      .map((l) => l.filament_id),
  }));
}
function orderRows(where = "1=1", params: any[] = [], limit = 1000000) {
  const orders = all(
    `SELECT * FROM orders WHERE ${where} ORDER BY id DESC LIMIT ?`,
    ...params,
    limit,
  );
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id),
    placeholders = ids.map(() => "?").join(",");
  const items = all(
    `SELECT * FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id`,
    ...ids,
  );
  const pieces = all(
    `SELECT p.* FROM order_pieces p JOIN order_items i ON i.id=p.item_id WHERE i.order_id IN (${placeholders}) ORDER BY p.ordinal`,
    ...ids,
  );
  const shipments = all(
    `SELECT * FROM shipments WHERE order_id IN (${placeholders}) ORDER BY id DESC`,
    ...ids,
  );
  const costs = all(
    `SELECT order_id_snapshot AS order_id, SUM(material_cost+machine_cost+energy_cost) AS actual_cost, SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running_jobs FROM print_jobs WHERE order_id_snapshot IN (${placeholders}) GROUP BY order_id_snapshot`,
    ...ids,
  );
  const costsByOrder = new Map(costs.map((row) => [row.order_id, row]));
  const group = (rows: Row[], key: string) => {
    const map = new Map<number, Row[]>();
    for (const row of rows) {
      const entries = map.get(row[key]) || [];
      entries.push(row);
      map.set(row[key], entries);
    }
    return map;
  };
  const piecesByItem = group(pieces, "item_id"),
    itemsByOrder = group(items, "order_id"),
    shipmentsByOrder = group(shipments, "order_id");
  return orders.map((o) => ({
    ...o,
    id: o.id,
    status: o.cancelled ? "cancelled" : o.is_draft ? "draft" : o.status,
    items: (itemsByOrder.get(o.id) || []).map((i) => ({
      ...i,
      pieces: piecesByItem.get(i.id) || [],
    })),
    actual_cost: costsByOrder.get(o.id)?.actual_cost || 0,
    running_jobs: costsByOrder.get(o.id)?.running_jobs || 0,
    shipments: shipmentsByOrder.get(o.id) || [],
  }));
}
function orderFilterQuery(filter: string, query: string) {
  const clauses: Record<string, string> = {
    all: "archived=0 AND cancelled=0",
    draft: "archived=0 AND cancelled=0 AND is_draft=1",
    active: "archived=0 AND cancelled=0 AND is_draft=0 AND status<>'shipped'",
    shipped: "archived=0 AND cancelled=0 AND status='shipped'",
    cancelled: "archived=0 AND cancelled=1",
    archived: "archived=1",
  };
  if (!clauses[filter]) throw new RequestError("Invalid order filter");
  const where =
    clauses[filter] +
    (query
      ? " AND (CAST(id AS TEXT) LIKE ? OR customer LIKE ? OR id IN(SELECT order_id FROM order_items WHERE product_name LIKE ?))"
      : "");
  return {
    where,
    params: query ? [`%${query}%`, `%${query}%`, `%${query}%`] : [],
  };
}
function expectVersion(table: string, recordId: number, value: unknown) {
  const existing = one(`SELECT * FROM ${table} WHERE id=?`, recordId);
  if (!existing) throw new RequestError("Record not found", 404);
  if (value === undefined || Number(value) !== existing.version)
    throw new RequestError("This record changed. Refresh before saving", 409);
  return existing;
}
function writableOrder(orderId: number) {
  const order = one("SELECT * FROM orders WHERE id=?", orderId);
  if (!order) throw new RequestError("Order not found", 404);
  if (order.cancelled || order.archived)
    throw new RequestError("Restore this order before editing its items", 409);
  return order;
}
function updateOrderStatus(orderId: number) {
  const order = one("SELECT is_draft FROM orders WHERE id=?", orderId);
  if (!order || order.is_draft) return;
  const items = all("SELECT status FROM order_items WHERE order_id=?", orderId);
  const status = orderStatus(items.map((item) => item.status));
  run(
    "UPDATE orders SET status=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    status,
    orderId,
  );
}
function quantity(value: unknown, label: string, min: number, max: number) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max)
    throw new RequestError(`${label} must be between ${min} and ${max}`);
  return number;
}
function itemProduct(b: Row) {
  const productId = id(String(b.product_id));
  const product = one(
    "SELECT * FROM products WHERE id=? AND archived=0",
    productId,
  );
  if (!product) throw new RequestError("Product not found");
  const filamentId = b.filament_id ? id(String(b.filament_id)) : null;
  const filament = filamentId
    ? one(
        "SELECT f.* FROM filaments f JOIN product_filaments pf ON pf.filament_id=f.id WHERE pf.product_id=? AND f.id=? AND f.archived=0",
        productId,
        filamentId,
      )
    : null;
  if (filamentId && !filament)
    throw new RequestError("That filament is not offered for this product");
  return { productId, product, filamentId, filament };
}
function checkDeadlineReminders() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.TZ || "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  if (Number(parts.hour) < 9) return;
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const todayDay = Date.parse(today) / 86400000;
  let changed = false;
  for (const order of all(
    "SELECT id,customer,ship_by FROM orders WHERE is_draft=0 AND cancelled=0 AND archived=0 AND status<>'shipped' AND ship_by<>''",
  )) {
    const days = Date.parse(order.ship_by) / 86400000 - todayDay;
    if (days > 2) continue;
    const overdue = days < 0;
    const kind = overdue ? "deadline_overdue" : "deadline_soon";
    const result = run(
      "INSERT OR IGNORE INTO deadline_reminders (order_id,kind,ship_by) VALUES (?,?,?)",
      order.id,
      kind,
      order.ship_by,
    );
    if (!result.changes) continue;
    const detail = overdue
      ? `Order #${order.id} for ${order.customer} is overdue (ship by ${order.ship_by}).`
      : `Order #${order.id} for ${order.customer} is due to ship ${days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`} (${order.ship_by}).`;
    activity(null, order.id, kind, detail);
    notify(
      kind,
      overdue ? "Shipping deadline overdue" : "Shipping deadline approaching",
      detail,
      order.id,
    );
    changed = true;
  }
  if (changed) broadcastChange();
}
const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};
const port = Number(process.env.PORT || 3000);
const liveClients = new Map<
  ReadableStreamDefaultController<Uint8Array>,
  Request
>();
const liveEncoder = new TextEncoder();
function sendLive(chunk: Uint8Array) {
  for (const [client, request] of liveClients) {
    if (!userFrom(request)) {
      try {
        client.close();
      } catch {}
      liveClients.delete(client);
      continue;
    }
    try {
      if ((client.desiredSize ?? 0) > 0) client.enqueue(chunk);
    } catch {
      liveClients.delete(client);
    }
  }
}
function broadcastChange() {
  sendLive(liveEncoder.encode(`data: ${Date.now()}\n\n`));
}
setInterval(() => sendLive(liveEncoder.encode(": ping\n\n")), 20_000);
function liveResponse(request: Request) {
  let client: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      client = controller;
      liveClients.set(controller, request);
      controller.enqueue(liveEncoder.encode(": connected\n\n"));
    },
    cancel() {
      liveClients.delete(client);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
const loginAttempts = new Map<string, { count: number; reset: number }>();
setInterval(() => {
  run("DELETE FROM sessions WHERE expires_at<=datetime('now')");
  for (const [key, value] of loginAttempts)
    if (value.reset < Date.now()) loginAttempts.delete(key);
}, 60_000);
async function handleRequest(
  req: Request,
  server: {
    timeout: (req: Request, seconds: number) => void;
    requestIP?: (req: Request) => { address: string } | null;
  },
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (path === "/healthz") return json({ ok: one("SELECT 1 AS ok")?.ok === 1 });
  if (!path.startsWith("/api/")) {
    const root = path.startsWith("/uploads/")
      ? resolve(uploadDir)
      : resolve("./dist");
    const relative = path.startsWith("/uploads/")
      ? path.slice(9)
      : path.slice(1);
    const file = resolve(root, relative || "index.html");
    if (!file.startsWith(root + "/") && file !== root)
      return bad("Not found", 404);
    if (path.startsWith("/uploads/") && !userFrom(req))
      return bad("Please sign in", 401);
    const selected = existsSync(file)
      ? file
      : root.endsWith("dist") && !extname(path)
        ? join(root, "index.html")
        : "";
    if (!selected || !existsSync(selected)) return bad("Not found", 404);
    return new Response(Bun.file(selected), {
      headers: {
        "Content-Type": mime[extname(selected)] || "application/octet-stream",
      },
    });
  }
  if (req.method !== "GET") {
    const origin = req.headers.get("origin");
    if (
      origin &&
      origin !==
        `${req.headers.get("x-forwarded-proto") === "https" ? "https:" : url.protocol}//${url.host}`
    )
      return bad("Invalid request origin", 403);
  }
  try {
    if (path === "/api/bootstrap" && req.method === "GET") {
      const user = userFrom(req);
      return json({
        needsSetup: !one("SELECT id FROM users LIMIT 1"),
        user,
        users: user?.is_admin
          ? all(
              "SELECT id,name,username,is_admin,created_at FROM users ORDER BY id",
            )
          : [],
        settings: settings(),
        totals: user
          ? one(
              "SELECT COUNT(*) AS shipped_orders FROM orders WHERE is_draft=0 AND status='shipped' AND cancelled=0",
            )
          : null,
        notifications: user
          ? {
              preferences: preferences(user.id),
              vapidPublicKey: vapidPublic,
              subscribed: !!one(
                "SELECT endpoint FROM push_subscriptions WHERE user_id=? LIMIT 1",
                user.id,
              ),
            }
          : null,
        filaments: user ? all("SELECT * FROM filaments ORDER BY name") : [],
        products: user ? productRows() : [],
        orders: user
          ? orderRows(
              "(cancelled=0 AND archived=0 AND status<>'shipped') OR id IN(SELECT id FROM orders ORDER BY id DESC LIMIT 50) OR id=?",
              [Number(url.searchParams.get("order")) || 0],
            )
          : [],
        jobs: user
          ? all(
              "SELECT j.*,u.name AS operator_name,j.product_name_snapshot AS product_name,j.ordinal_snapshot AS ordinal,j.order_id_snapshot AS order_id FROM print_jobs j LEFT JOIN users u ON u.id=j.operator_id LEFT JOIN order_pieces p ON p.id=j.piece_id LEFT JOIN order_items i ON i.id=p.item_id ORDER BY j.id DESC LIMIT 100",
            )
          : [],
        activity: user
          ? all("SELECT * FROM activity_events ORDER BY id DESC LIMIT 100")
          : [],
      });
    }
    if (["/api/setup", "/api/login"].includes(path) && req.method === "POST") {
      const address = server.requestIP?.(req)?.address || "local";
      const attempts = loginAttempts.get(address) || {
        count: 0,
        reset: Date.now() + 60_000,
      };
      if (attempts.reset < Date.now()) {
        attempts.count = 0;
        attempts.reset = Date.now() + 60_000;
      }
      attempts.count++;
      loginAttempts.set(address, attempts);
      if (attempts.count > 10)
        return bad("Too many attempts. Try again in a minute", 429);
    }
    if (path === "/api/setup" && req.method === "POST") {
      if (one("SELECT id FROM users LIMIT 1"))
        return bad("Setup is already complete", 409);
      const b = await body(req);
      const name = required(b.name, "Name", 100),
        login = username(b.username);
      const password = b.password;
      const passwordHash = await hashPassword(password);
      const token = randomBytes(32).toString("hex");
      const created = db.transaction(() => {
        if (one("SELECT id FROM users LIMIT 1")) return false;
        const result = run(
          "INSERT INTO users (name,username,email,password_hash,is_admin) VALUES (?,?,?,?,1)",
          name,
          login,
          `user-${randomBytes(12).toString("hex")}@local.invalid`,
          passwordHash,
        );
        run(
          "INSERT INTO sessions VALUES (?,?,datetime('now','+30 days'))",
          hash(token),
          result.lastInsertRowid,
        );
        return true;
      })();
      if (!created) return bad("Setup is already complete", 409);
      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": cookie(req, token, 2592000),
        },
      });
    }
    if (path === "/api/login" && req.method === "POST") {
      const b = await body(req);
      const login = optional(b.username ?? b.email, 200);
      if (typeof b.password !== "string" || b.password.length > 1024)
        return bad("Invalid password");
      const user = one(
        "SELECT * FROM users WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE",
        login,
        login,
      );
      if (
        !user ||
        !(await verifyPassword(String(b.password ?? ""), user.password_hash))
      )
        return bad("Incorrect username or password", 401);
      const token = randomBytes(32).toString("hex");
      run(
        "INSERT INTO sessions VALUES (?,?,datetime('now','+30 days'))",
        hash(token),
        user.id,
      );
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": cookie(req, token, 2592000),
        },
      });
    }
    if (path === "/api/logout" && req.method === "POST") {
      const token = req.headers
        .get("cookie")
        ?.match(/(?:^|; )session=([^;]+)/)?.[1];
      if (token) run("DELETE FROM sessions WHERE token_hash=?", hash(token));
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": cookie(req, "", 0),
        },
      });
    }
    const currentUser = userFrom(req);
    if (!currentUser) return bad("Please sign in", 401);
    if (path === "/api/events" && req.method === "GET") {
      server.timeout(req, 0);
      return liveResponse(req);
    }
    if (path === "/api/account/password" && req.method === "PUT") {
      const b = await body(req),
        user = one(
          "SELECT password_hash FROM users WHERE id=?",
          currentUser.id,
        )!;
      if (
        typeof b.current_password !== "string" ||
        b.current_password.length > 1024 ||
        !(await verifyPassword(b.current_password, user.password_hash))
      )
        return bad("Current password is incorrect", 401);
      const passwordHash = await hashPassword(b.password);
      const token = req.headers
        .get("cookie")
        ?.match(/(?:^|; )session=([^;]+)/)?.[1];
      db.transaction(() => {
        run(
          "UPDATE users SET password_hash=? WHERE id=?",
          passwordHash,
          currentUser.id,
        );
        run(
          "DELETE FROM sessions WHERE user_id=? AND token_hash<>?",
          currentUser.id,
          hash(token || ""),
        );
      })();
      return json({ ok: true });
    }
    if (path === "/api/orders" && req.method === "GET") {
      const { where, params } = orderFilterQuery(
        url.searchParams.get("filter") || "all",
        optional(url.searchParams.get("q"), 200),
      );
      const before =
        Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
      const rows = orderRows(`(${where}) AND id<?`, [...params, before], 50);
      const total = one(
        `SELECT COUNT(*) AS count FROM orders WHERE ${where}`,
        ...params,
      )!.count;
      const counts = Object.fromEntries(
        ["all", "draft", "active", "shipped", "cancelled", "archived"].map(
          (filter) => {
            const clause = orderFilterQuery(filter, "");
            return [
              filter,
              one(`SELECT COUNT(*) AS count FROM orders WHERE ${clause.where}`)!
                .count,
            ];
          },
        ),
      );
      return json({
        orders: rows,
        total,
        counts,
        next: rows.length === 50 ? rows.at(-1)!.id : null,
      });
    }
    const history = path.match(/^\/api\/orders\/(\d+)\/activity$/);
    if (history && req.method === "GET") {
      const orderId = id(history[1]);
      if (!one("SELECT id FROM orders WHERE id=?", orderId))
        return bad("Order not found", 404);
      const before =
        Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
      return json(
        all(
          "SELECT * FROM activity_events WHERE order_id=? AND id<? ORDER BY id DESC LIMIT 50",
          orderId,
          before,
        ),
      );
    }
    const pieceAction = path.match(/^\/api\/pieces\/(\d+)\/action$/);
    if (pieceAction && req.method === "POST") {
      const b = await body(req),
        pieceId = id(pieceAction[1]);
      const previous = one(
        "SELECT o.status FROM orders o JOIN order_items i ON i.order_id=o.id JOIN order_pieces p ON p.item_id=i.id WHERE p.id=?",
        pieceId,
      )?.status;
      const piece = db.transaction(() => {
        const result = workshop.transition(
          pieceId,
          String(b.action),
          Number(b.version),
          currentUser.id,
          optional(b.printer, 100),
          optional(b.notes),
          b.actual_grams === undefined
            ? undefined
            : positiveNumber(b.actual_grams, "Actual material used", 100000),
        );
        activity(
          currentUser,
          result.order_id,
          "piece_" + b.action,
          `${b.action}: ${result.product_name}, piece ${result.ordinal}.`,
        );
        return result;
      })();
      notify(
        "print_stage",
        "Print progress updated",
        `${piece.product_name}, piece ${piece.ordinal}: ${piece.status}.`,
        piece.order_id,
      );
      if (
        previous !== "shipped" &&
        one("SELECT status FROM orders WHERE id=?", piece.order_id)?.status ===
          "shipped"
      )
        notify(
          "order_shipped",
          "Order shipped",
          `All pieces in order #${piece.order_id} have shipped.`,
          piece.order_id,
        );
      return json({ ok: true });
    }
    if (path === "/api/jobs" && req.method === "GET")
      return json(
        all(
          "SELECT j.*,u.name AS operator_name,j.product_name_snapshot AS product_name,j.ordinal_snapshot AS ordinal,j.order_id_snapshot AS order_id FROM print_jobs j LEFT JOIN users u ON u.id=j.operator_id LEFT JOIN order_pieces p ON p.id=j.piece_id LEFT JOIN order_items i ON i.id=p.item_id WHERE j.id<? ORDER BY j.id DESC LIMIT 100",
          Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER,
        ),
      );
    const movements = path.match(/^\/api\/filaments\/(\d+)\/movements$/);
    if (movements && req.method === "GET")
      return json(
        all(
          "SELECT m.*,u.name AS actor_name FROM stock_movements m LEFT JOIN users u ON u.id=m.actor_id WHERE filament_id=? ORDER BY id DESC LIMIT 100",
          id(movements[1]),
        ),
      );
    if (path === "/api/users" && req.method === "GET") {
      if (!currentUser.is_admin) return bad("Admin access required", 403);
      return json(
        all(
          "SELECT id,name,username,is_admin,created_at FROM users ORDER BY id",
        ),
      );
    }
    if (path === "/api/users" && req.method === "POST") {
      if (!currentUser.is_admin) return bad("Admin access required", 403);
      const b = await body(req),
        login = username(b.username),
        password = b.password;
      if (one("SELECT id FROM users WHERE username=? COLLATE NOCASE", login))
        return bad("That username is already in use", 409);
      run(
        "INSERT INTO users (name,username,email,password_hash) VALUES (?,?,?,?)",
        required(b.name, "Name", 100),
        login,
        `user-${randomBytes(12).toString("hex")}@local.invalid`,
        await hashPassword(password),
      );
      return json({ ok: true }, 201);
    }
    const userPassword = path.match(/^\/api\/users\/(\d+)\/password$/);
    if (userPassword && req.method === "PUT") {
      if (!currentUser.is_admin) return bad("Admin access required", 403);
      const targetId = id(userPassword[1]);
      if (!one("SELECT id FROM users WHERE id=?", targetId))
        return bad("User not found", 404);
      const b = await body(req);
      if (typeof b.password !== "string") return bad("Password is required");
      const passwordHash = await hashPassword(b.password);
      db.transaction(() => {
        run(
          "UPDATE users SET password_hash=? WHERE id=?",
          passwordHash,
          targetId,
        );
        if (targetId === currentUser.id) {
          const token = req.headers
            .get("cookie")
            ?.match(/(?:^|; )session=([^;]+)/)?.[1];
          run(
            "DELETE FROM sessions WHERE user_id=? AND token_hash<>?",
            targetId,
            hash(token || ""),
          );
        } else run("DELETE FROM sessions WHERE user_id=?", targetId);
      })();
      return json({ ok: true });
    }
    const userAccount = path.match(/^\/api\/users\/(\d+)$/);
    if (userAccount && req.method === "DELETE") {
      if (!currentUser.is_admin) return bad("Admin access required", 403);
      const targetId = id(userAccount[1]);
      const target = one("SELECT is_admin FROM users WHERE id=?", targetId);
      if (!target) return bad("User not found", 404);
      if (targetId === currentUser.id)
        return bad("You cannot delete your own account", 409);
      if (
        target.is_admin &&
        !one(
          "SELECT id FROM users WHERE is_admin=1 AND id<>? LIMIT 1",
          targetId,
        )
      )
        return bad("The last owner cannot be deleted", 409);
      run("DELETE FROM users WHERE id=?", targetId);
      return json({ ok: true });
    }
    if (path === "/api/settings" && req.method === "PUT") {
      if (!currentUser.is_admin) return bad("Admin access required", 403);
      const b = await body(req);
      const currency = String(b.currency ?? "")
        .trim()
        .toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency))
        return bad("Choose a three-letter currency code");
      try {
        new Intl.NumberFormat("en", { style: "currency", currency });
      } catch {
        return bad("Unsupported currency code");
      }
      const costs = Object.fromEntries(
        (
          [
            "machine_hourly_rate",
            "electricity_per_kwh",
            "printer_watts",
          ] as const
        ).map((key) => [
          key,
          positiveNumber(b[key] ?? settings()[key], key, 1000000),
        ]),
      );
      const features = Object.fromEntries(
        Object.keys(featureDefaults).map((key) => {
          if (b[key] !== undefined && typeof b[key] !== "boolean")
            throw new RequestError("Feature settings must be true or false");
          return [
            key,
            b[key] ?? settings()[key as keyof typeof featureDefaults],
          ];
        }),
      );
      db.transaction(() => {
        for (const [key, value] of Object.entries({
          ...costs,
          ...features,
          show_money: b.show_money ? "true" : "false",
          currency,
        }))
          run(
            "INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            key,
            String(value),
          );
      })();
      return json({ ok: true });
    }
    if (path === "/api/notification-preferences" && req.method === "PUT") {
      const b = await body(req);
      if (noticeKinds.some((kind) => typeof b[kind] !== "boolean"))
        return bad("Invalid notification preferences");
      preferences(currentUser.id);
      run(
        `UPDATE notification_preferences SET ${noticeKinds.map((kind) => `${kind}=?`).join(",")} WHERE user_id=?`,
        ...noticeKinds.map((kind) => (b[kind] ? 1 : 0)),
        currentUser.id,
      );
      return json({ ok: true });
    }
    if (path === "/api/push-subscriptions/status" && req.method === "GET")
      return json({
        subscribed: !!one(
          "SELECT endpoint FROM push_subscriptions WHERE user_id=? AND endpoint=?",
          currentUser.id,
          url.searchParams.get("endpoint") || "",
        ),
      });
    if (path === "/api/push-subscriptions" && req.method === "POST") {
      const b = await body(req),
        subscription = b.subscription;
      const endpoint = String(subscription?.endpoint ?? "");
      validatePushSubscription(subscription);
      run(
        "INSERT INTO push_subscriptions (endpoint,user_id,subscription_json) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription_json=excluded.subscription_json",
        endpoint,
        currentUser.id,
        JSON.stringify(subscription),
      );
      return json({ ok: true }, 201);
    }
    if (path === "/api/push-subscriptions" && req.method === "DELETE") {
      const b = await body(req);
      run(
        "DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?",
        String(b.endpoint ?? ""),
        currentUser.id,
      );
      return json({ ok: true });
    }
    if (path === "/api/notifications/test" && req.method === "POST") {
      const subscriptions = all(
        "SELECT endpoint,subscription_json FROM push_subscriptions WHERE user_id=?",
        currentUser.id,
      );
      if (!subscriptions.length)
        return bad("Enable notifications on this device first");
      const delivered = await Promise.all(
        subscriptions.map(async (subscription) => {
          try {
            await webpush.sendNotification(
              JSON.parse(subscription.subscription_json),
              JSON.stringify({
                title: "Printroom notifications are ready",
                body: "You'll hear from your studio when the events you selected happen.",
                url: "/",
              }),
              { TTL: 300 },
            );
            return true;
          } catch (error: any) {
            if (error?.statusCode === 404 || error?.statusCode === 410)
              run(
                "DELETE FROM push_subscriptions WHERE endpoint=?",
                subscription.endpoint,
              );
            console.error("Test push failed:", error?.message || error);
            return false;
          }
        }),
      );
      if (!delivered.some(Boolean))
        return bad(
          "The push service rejected the test. Try enabling notifications again.",
          502,
        );
      return json({ ok: true });
    }
    if (path === "/api/filaments" && req.method === "POST") {
      const b = await body(req);
      const color = String(b.color ?? "");
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) return bad("Choose a valid colour");
      const stock = filamentStock(b);
      const remaining = positiveNumber(
        b.remaining_grams ?? stock.count * stock.grams,
        "Remaining grams",
        1_000_000_000,
      );
      const cost = positiveNumber(b.cost_per_kg, "Cost per kg");
      db.transaction(() => {
        run(
          "INSERT INTO filaments (name,brand,material,color,notes,image_url,spool_count,grams_per_spool) VALUES (?,?,?,?,?,?,?,?)",
          required(b.name, "Filament name"),
          optional(b.brand, 100),
          required(b.material, "Material", 50),
          color,
          optional(b.notes),
          optional(b.image_url, 500),
          stock.count,
          stock.grams,
        );
        const filamentId = one("SELECT last_insert_rowid() AS id")!.id;
        run(
          "UPDATE filaments SET remaining_grams=?,cost_per_kg=? WHERE id=?",
          remaining,
          cost,
          filamentId,
        );
      })();
      return json({ ok: true }, 201);
    }
    const filament = path.match(/^\/api\/filaments\/(\d+)$/);
    if (filament && req.method === "PUT") {
      const b = await body(req),
        color = String(b.color ?? "");
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) return bad("Choose a valid colour");
      const stock = filamentStock(b);
      const existing = expectVersion("filaments", id(filament[1]), b.version);
      const remaining = positiveNumber(
        b.remaining_grams ?? existing.remaining_grams,
        "Remaining grams",
        1_000_000_000,
      );
      const cost = positiveNumber(
        b.cost_per_kg ?? existing.cost_per_kg,
        "Cost per kg",
      );
      db.transaction(() => {
        run(
          "UPDATE filaments SET name=?,brand=?,material=?,color=?,notes=?,image_url=?,spool_count=?,grams_per_spool=?,version=version+1 WHERE id=?",
          required(b.name, "Filament name"),
          optional(b.brand, 100),
          required(b.material, "Material", 50),
          color,
          optional(b.notes),
          optional(b.image_url, 500),
          stock.count,
          stock.grams,
          id(filament[1]),
        );
        run(
          "UPDATE filaments SET remaining_grams=?,cost_per_kg=? WHERE id=?",
          remaining,
          cost,
          existing.id,
        );
        if (
          remaining !== existing.remaining_grams ||
          stock.count !== existing.spool_count
        )
          run(
            "INSERT INTO stock_movements(filament_id,actor_id,spool_delta,grams_delta,detail) VALUES(?,?,?,?,?)",
            existing.id,
            currentUser.id,
            stock.count - existing.spool_count,
            remaining - existing.remaining_grams,
            "Manual stock correction",
          );
      })();
      return json({ ok: true });
    }
    const filamentStockPath = path.match(/^\/api\/filaments\/(\d+)\/stock$/);
    if (filamentStockPath && req.method === "PUT") {
      const b = await body(req),
        filamentId = id(filamentStockPath[1]);
      const delta = quantity(b.delta, "Stock adjustment", -100000, 100000);
      db.transaction(() => {
        const existing = one("SELECT * FROM filaments WHERE id=?", filamentId);
        if (!existing) throw new RequestError("Filament not found", 404);
        const count = existing.spool_count + delta,
          grams = Math.max(
            0,
            existing.remaining_grams + delta * existing.grams_per_spool,
          );
        if (count < 0 || count > 100000 || grams < 0)
          throw new RequestError(
            "Stock cannot go below zero or exceed 100,000 spools",
            409,
          );
        run(
          "UPDATE filaments SET spool_count=?,remaining_grams=?,version=version+1 WHERE id=?",
          count,
          grams,
          filamentId,
        );
        run(
          "INSERT INTO stock_movements(filament_id,actor_id,spool_delta,grams_delta,detail) VALUES(?,?,?,?,?)",
          filamentId,
          currentUser.id,
          delta,
          grams - existing.remaining_grams,
          "Spool adjustment",
        );
      })();
      return json({ ok: true });
    }
    if (filament && req.method === "DELETE") {
      if (
        one(
          "SELECT p.id FROM order_pieces p JOIN order_items i ON i.id=p.item_id WHERE i.filament_id=? AND p.status='printing'",
          id(filament[1]),
        )
      )
        return bad("Stop the active print before deleting its filament", 409);
      if (!one("SELECT id FROM filaments WHERE id=?", id(filament[1])))
        return bad("Filament not found", 404);
      run(
        "UPDATE filaments SET archived=1,version=version+1 WHERE id=?",
        id(filament[1]),
      );
      return json({ ok: true });
    }
    if (path === "/api/products" && req.method === "POST") {
      const b = await body(req),
        price = Number(b.price ?? 0);
      if (!Number.isFinite(price) || price < 0)
        return bad("Price must be zero or more");
      const ids = Array.isArray(b.filament_ids)
        ? b.filament_ids.map((value) => id(String(value)))
        : [];
      if (ids.some((fid) => !one("SELECT id FROM filaments WHERE id=?", fid)))
        return bad("Filament not found", 404);
      const details = productionDetails(b);
      const tx = db.transaction(() => {
        const result = run(
          "INSERT INTO products (name,description,image_url,price) VALUES (?,?,?,?)",
          required(b.name, "Product name"),
          optional(b.description),
          optional(b.image_url, 500),
          price,
        );
        run(
          "UPDATE products SET grams_per_piece=?,minutes_per_piece=?,production_url=?,revision=?,print_profile=? WHERE id=?",
          details.grams,
          details.minutes,
          details.url,
          details.revision,
          details.profile,
          result.lastInsertRowid,
        );
        for (const filamentId of new Set(ids))
          run(
            "INSERT INTO product_filaments VALUES (?,?)",
            result.lastInsertRowid,
            filamentId,
          );
      });
      tx();
      return json({ ok: true }, 201);
    }
    const product = path.match(/^\/api\/products\/(\d+)$/);
    if (product && req.method === "PUT") {
      const b = await body(req),
        price = Number(b.price ?? 0),
        productId = id(product[1]);
      if (!Number.isFinite(price) || price < 0)
        return bad("Price must be zero or more");
      const ids = Array.isArray(b.filament_ids)
        ? b.filament_ids.map((value) => id(String(value)))
        : [];
      if (ids.some((fid) => !one("SELECT id FROM filaments WHERE id=?", fid)))
        return bad("Filament not found", 404);
      const details = productionDetails(b);
      expectVersion("products", productId, b.version);
      db.transaction(() => {
        run(
          "UPDATE products SET name=?,description=?,image_url=?,price=?,version=version+1 WHERE id=?",
          required(b.name, "Product name"),
          optional(b.description),
          optional(b.image_url, 500),
          price,
          productId,
        );
        run(
          "UPDATE products SET grams_per_piece=?,minutes_per_piece=?,production_url=?,revision=?,print_profile=? WHERE id=?",
          details.grams,
          details.minutes,
          details.url,
          details.revision,
          details.profile,
          productId,
        );
        run("DELETE FROM product_filaments WHERE product_id=?", productId);
        for (const filamentId of new Set(ids))
          run(
            "INSERT INTO product_filaments VALUES (?,?)",
            productId,
            filamentId,
          );
      })();
      return json({ ok: true });
    }
    if (product && req.method === "DELETE") {
      if (!one("SELECT id FROM products WHERE id=?", id(product[1])))
        return bad("Product not found", 404);
      run(
        "UPDATE products SET archived=1,version=version+1 WHERE id=?",
        id(product[1]),
      );
      return json({ ok: true });
    }
    const restoreCatalogue = path.match(
      /^\/api\/(products|filaments)\/(\d+)\/restore$/,
    );
    if (restoreCatalogue && req.method === "POST") {
      const b = await body(req),
        table = restoreCatalogue[1],
        recordId = id(restoreCatalogue[2]);
      expectVersion(table, recordId, b.version);
      run(
        `UPDATE ${table} SET archived=0,version=version+1 WHERE id=?`,
        recordId,
      );
      return json({ ok: true });
    }
    if (path === "/api/upload" && req.method === "POST") {
      const form = await req.formData(),
        file = form.get("file");
      if (
        !(file instanceof File) ||
        file.size > 5_000_000 ||
        file.size < 1 ||
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      )
        return bad("Upload a PNG, JPEG or WebP image under 5 MB");
      const extension = await imageExtension(file);
      const filename = randomBytes(16).toString("hex") + extension;
      await Bun.write(join(uploadDir, filename), file);
      return json({ url: "/uploads/" + filename }, 201);
    }
    if (path === "/api/orders" && req.method === "POST") {
      const b = await body(req);
      const result = db.transaction(() => {
        const result = run(
          "INSERT INTO orders (customer,contact,notes,ship_by,is_draft) VALUES (?,?,?,?,1)",
          required(b.customer, "Customer"),
          optional(b.contact, 200),
          optional(b.notes),
          shipBy(b.ship_by),
        );
        run(
          "UPDATE orders SET currency=? WHERE id=?",
          settings().currency,
          result.lastInsertRowid,
        );
        activity(
          currentUser,
          Number(result.lastInsertRowid),
          "draft_created",
          `Created draft for ${String(b.customer).trim()}.`,
        );
        const rates = settings();
        run(
          "UPDATE orders SET machine_hourly_rate=?,electricity_per_kwh=?,printer_watts=? WHERE id=?",
          rates.cost_reporting ? rates.machine_hourly_rate : 0,
          rates.cost_reporting ? rates.electricity_per_kwh : 0,
          rates.cost_reporting ? rates.printer_watts : 0,
          Number(result.lastInsertRowid),
        );
        return result;
      })();
      notify(
        "draft_created",
        "New draft order",
        `Order #${result.lastInsertRowid} for ${String(b.customer).trim()} was created.`,
        Number(result.lastInsertRowid),
      );
      return json({ ok: true, id: Number(result.lastInsertRowid) }, 201);
    }
    const order = path.match(/^\/api\/orders\/(\d+)$/);
    if (order && req.method === "PUT") {
      const b = await body(req);
      const orderId = id(order[1]),
        existing = one("SELECT * FROM orders WHERE id=?", orderId);
      if (!existing) return bad("Order not found", 404);
      expectVersion("orders", orderId, b.version);
      const deadline = shipBy(b.ship_by);
      run(
        "UPDATE orders SET customer=?,contact=?,notes=?,ship_by=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        required(b.customer, "Customer"),
        optional(b.contact, 200),
        optional(b.notes),
        deadline,
        orderId,
      );
      activity(
        currentUser,
        orderId,
        "order_updated",
        existing.ship_by !== deadline
          ? `Updated order details and ship-by date to ${deadline || "none"}.`
          : "Updated order details.",
      );
      setTimeout(checkDeadlineReminders, 1000);
      return json({ ok: true });
    }
    const lifecycle = path.match(/^\/api\/orders\/(\d+)\/lifecycle$/);
    if (lifecycle && req.method === "POST") {
      const b = await body(req),
        orderId = id(lifecycle[1]),
        existing = expectVersion("orders", orderId, b.version);
      if (
        one(
          "SELECT p.id FROM order_pieces p JOIN order_items i ON i.id=p.item_id WHERE i.order_id=? AND p.status='printing'",
          orderId,
        )
      )
        return bad("Stop the active print first", 409);
      if (!["cancel", "archive", "restore"].includes(b.action))
        return bad("Choose cancel, archive or restore");
      if (
        b.action === "archive" &&
        !existing.cancelled &&
        existing.status !== "shipped"
      )
        return bad("Ship or cancel this order before archiving", 409);
      run(
        "UPDATE orders SET cancelled=?,archived=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        b.action === "cancel"
          ? 1
          : b.action === "restore"
            ? 0
            : existing.cancelled,
        b.action === "archive" ? 1 : 0,
        orderId,
      );
      activity(
        currentUser,
        orderId,
        "order_" + b.action,
        `${b.action} order #${orderId}.`,
      );
      return json({ ok: true });
    }
    const payment = path.match(/^\/api\/orders\/(\d+)\/payment$/);
    if (payment && req.method === "PUT") {
      const b = await body(req),
        orderId = id(payment[1]);
      expectVersion("orders", orderId, b.version);
      if (!["unpaid", "deposit", "paid", "refunded"].includes(b.payment_status))
        return bad("Invalid payment status");
      run(
        "UPDATE orders SET payment_status=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        b.payment_status,
        orderId,
      );
      activity(
        currentUser,
        orderId,
        "payment_updated",
        `Payment marked ${b.payment_status}.`,
      );
      return json({ ok: true });
    }
    const shipment = path.match(/^\/api\/orders\/(\d+)\/shipments$/);
    if (shipment && req.method === "POST") {
      const b = await body(req),
        orderId = id(shipment[1]);
      writableOrder(orderId);
      if (!Array.isArray(b.piece_ids) || !b.piece_ids.length)
        return bad("Select printed pieces to ship");
      db.transaction(() => {
        const shipmentId = run(
          "INSERT INTO shipments(order_id,carrier,tracking) VALUES(?,?,?)",
          orderId,
          optional(b.carrier, 100),
          optional(b.tracking, 200),
        ).lastInsertRowid;
        for (const pieceId of new Set(
          b.piece_ids.map((v: unknown) => id(String(v))),
        )) {
          const piece = one(
            "SELECT p.* FROM order_pieces p JOIN order_items i ON i.id=p.item_id WHERE p.id=? AND i.order_id=?",
            pieceId,
            orderId,
          );
          if (!piece || piece.status !== "printed")
            throw new RequestError(
              "A selected piece is no longer ready to ship",
              409,
            );
          workshop.transition(
            piece.id,
            "ship",
            piece.version,
            currentUser.id,
            "",
            "",
          );
          run(
            "INSERT INTO shipment_pieces(shipment_id,piece_id,product_name,ordinal) VALUES(?,?,?,?)",
            shipmentId,
            piece.id,
            one(
              "SELECT product_name FROM order_items WHERE id=?",
              piece.item_id,
            )!.product_name,
            piece.ordinal,
          );
        }
        activity(
          currentUser,
          orderId,
          "shipment_created",
          `Dispatched ${b.piece_ids.length} pieces${b.tracking ? " · " + optional(b.tracking, 200) : ""}.`,
        );
      })();
      if (
        one("SELECT status FROM orders WHERE id=?", orderId)?.status ===
        "shipped"
      )
        notify(
          "order_shipped",
          "Order shipped",
          `All pieces in order #${orderId} have shipped.`,
          orderId,
        );
      return json({ ok: true }, 201);
    }
    const confirm = path.match(/^\/api\/orders\/(\d+)\/confirm$/);
    if (confirm && req.method === "POST") {
      const orderId = id(confirm[1]);
      const existing = one("SELECT is_draft FROM orders WHERE id=?", orderId);
      if (!existing) return bad("Order not found", 404);
      if (!existing.is_draft)
        return bad("This order is already confirmed", 409);
      if (!one("SELECT id FROM order_items WHERE order_id=? LIMIT 1", orderId))
        return bad("Add at least one print item before confirming this sale");
      writableOrder(orderId);
      db.transaction(() => {
        run(
          "UPDATE orders SET is_draft=0,version=version+1,confirmed_at=CURRENT_TIMESTAMP,status='new',updated_at=CURRENT_TIMESTAMP WHERE id=?",
          orderId,
        );
        for (const item of all(
          "SELECT * FROM order_items WHERE order_id=?",
          orderId,
        ))
          workshop.reconcile(item.id, {
            ...item,
            printed_quantity: 0,
            shipped_quantity: 0,
          } as any);
      })();
      activity(
        currentUser,
        orderId,
        "sale_confirmed",
        "Confirmed the sale and added its items to the print queue.",
      );
      notify(
        "sale_confirmed",
        "Sale confirmed",
        `Order #${orderId} is ready to fulfill.`,
        orderId,
      );
      setTimeout(checkDeadlineReminders, 1000);
      return json({ ok: true });
    }
    if (order && req.method === "DELETE") {
      const orderId = id(order[1]);
      if (!one("SELECT id FROM orders WHERE id=?", orderId))
        return bad("Order not found", 404);
      const existing = one("SELECT * FROM orders WHERE id=?", orderId)!;
      if (!existing.is_draft)
        return bad(
          "Cancel or archive confirmed orders to preserve history",
          409,
        );
      activity(
        currentUser,
        orderId,
        "order_deleted",
        `Deleted draft #${orderId}.`,
      );
      run("DELETE FROM orders WHERE id=?", orderId);
      return json({ ok: true });
    }
    const items = path.match(/^\/api\/orders\/(\d+)\/items$/);
    if (items && req.method === "POST") {
      const b = await body(req),
        orderId = id(items[1]);
      writableOrder(orderId);
      const { productId, product, filamentId, filament } = itemProduct(b);
      const count = quantity(b.quantity, "Quantity", 1, 10000);
      run(
        "INSERT INTO order_items (order_id,product_id,product_name,filament_id,filament_name,color,quantity,unit_price,status) VALUES (?,?,?,?,?,?,?,?,?)",
        orderId,
        productId,
        product.name,
        filamentId,
        filament?.name ?? "",
        filament?.color ?? "#adb5bd",
        count,
        product.price,
        "queued",
      );
      const itemId = Number(one("SELECT last_insert_rowid() AS id")!.id);
      run(
        "UPDATE order_items SET grams_per_piece=?,minutes_per_piece=?,production_url=?,revision=?,print_profile=? WHERE id=?",
        product.grams_per_piece,
        product.minutes_per_piece,
        product.production_url,
        product.revision,
        product.print_profile,
        itemId,
      );
      run(
        "UPDATE order_items SET cost_per_kg=? WHERE id=?",
        filament?.cost_per_kg ?? 0,
        itemId,
      );
      workshop.reconcile(itemId, {
        quantity: count,
        printed_quantity: 0,
        shipped_quantity: 0,
        status: "queued",
      });
      activity(
        currentUser,
        orderId,
        "item_added",
        `Added ${count} × ${product.name}${filament ? ` in ${filament.name}` : ""}.`,
      );
      updateOrderStatus(orderId);
      run(
        "UPDATE orders SET version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        orderId,
      );
      return json({ ok: true }, 201);
    }
    if (/^\/api\/items\/\d+\/(status|progress)$/.test(path))
      return bad("Use the individual piece controls in the updated queue", 409);
    const item = path.match(/^\/api\/items\/(\d+)$/);
    if (item && req.method === "PUT") {
      const b = await body(req),
        itemId = id(item[1]);
      const existing = expectVersion("order_items", itemId, b.version);
      const order = writableOrder(existing.order_id);
      const productId = b.product_id === null ? null : id(String(b.product_id));
      const filamentId = b.filament_id ? id(String(b.filament_id)) : null;
      const sameProduct = productId === existing.product_id;
      const sameFilament = filamentId === existing.filament_id;
      let product = sameProduct ? existing : itemProduct(b).product;
      let filament =
        sameProduct && sameFilament
          ? { name: existing.filament_name, color: existing.color }
          : filamentId
            ? one(
                "SELECT f.* FROM filaments f JOIN product_filaments pf ON pf.filament_id=f.id WHERE pf.product_id=? AND f.id=? AND f.archived=0",
                productId,
                filamentId,
              )
            : null;
      if (filamentId && !filament)
        return bad("That filament is not offered for this product");
      const count = quantity(b.quantity, "Quantity", 1, 10000);
      const printed = quantity(b.printed_quantity, "Printed count", 0, count);
      const shipped = quantity(b.shipped_quantity, "Shipped count", 0, printed);
      if (order.is_draft && (printed || shipped))
        return bad("Confirm the sale before recording progress", 409);
      if (
        (!sameProduct || !sameFilament) &&
        (existing.printed_quantity || existing.shipped_quantity)
      )
        return bad(
          "Completed pieces cannot change product or filament. Add a separate item instead",
          409,
        );
      db.transaction(() => {
        run(
          "UPDATE order_items SET product_id=?,product_name=?,filament_id=?,filament_name=?,color=?,quantity=?,unit_price=?,grams_per_piece=?,minutes_per_piece=?,production_url=?,revision=?,print_profile=? WHERE id=?",
          productId,
          sameProduct ? existing.product_name : product.name,
          filamentId,
          filament?.name ?? "",
          filament?.color ?? "#adb5bd",
          count,
          sameProduct ? existing.unit_price : product.price,
          product.grams_per_piece,
          product.minutes_per_piece,
          product.production_url,
          product.revision,
          product.print_profile,
          itemId,
        );
        run(
          "UPDATE order_items SET cost_per_kg=? WHERE id=?",
          filament?.cost_per_kg ?? 0,
          itemId,
        );
        if (!sameProduct || !sameFilament)
          run(
            "UPDATE order_items SET cost_per_kg=? WHERE id=?",
            filament?.cost_per_kg ?? 0,
            itemId,
          );
        workshop.reconcile(itemId, {
          quantity: count,
          printed_quantity: printed,
          shipped_quantity: shipped,
          status: "queued",
        });
        activity(
          currentUser,
          existing.order_id,
          "item_updated",
          `Corrected ${sameProduct ? existing.product_name : product.name}: ${count} ordered, ${printed} printed, ${shipped} shipped.`,
        );
      })();
      return json({ ok: true });
    }
    if (item && req.method === "DELETE") {
      const itemId = id(item[1]);
      const existing = one(
        "SELECT order_id,product_name FROM order_items WHERE id=?",
        itemId,
      );
      if (!existing) return bad("Item not found", 404);
      const owningOrder = writableOrder(existing.order_id);
      if (
        !owningOrder.is_draft &&
        one(
          "SELECT COUNT(*) AS count FROM order_items WHERE order_id=?",
          existing.order_id,
        )!.count === 1
      )
        return bad("Cancel this order instead of removing its final item", 409);
      if (
        one(
          "SELECT id FROM order_pieces WHERE item_id=? AND status='printing'",
          itemId,
        )
      )
        return bad("Stop the active print before removing this item", 409);
      run("DELETE FROM order_items WHERE id=?", itemId);
      activity(
        currentUser,
        existing.order_id,
        "item_deleted",
        `Removed ${existing.product_name} from the order.`,
      );
      updateOrderStatus(existing.order_id);
      run(
        "UPDATE orders SET version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        existing.order_id,
      );
      return json({ ok: true });
    }
    return bad("Not found", 404);
  } catch (error) {
    console.error(error);
    return error instanceof RequestError
      ? bad(error.message, error.status)
      : bad("Something went wrong on the server", 500);
  }
}
const appServer = Bun.serve({
  port,
  maxRequestBodySize: 6_000_000,
  async fetch(req, server) {
    const response = await handleRequest(req, server);
    const path = new URL(req.url).pathname;
    if (
      response.ok &&
      req.method !== "GET" &&
      path.startsWith("/api/") &&
      ![
        "/api/logout",
        "/api/notifications/test",
        "/api/push-subscriptions",
      ].includes(path)
    )
      broadcastChange();
    return response;
  },
});
setTimeout(checkDeadlineReminders, 2000);
setInterval(checkDeadlineReminders, 15 * 60 * 1000);
console.log(`Printroom listening on :${port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    for (const client of liveClients.keys()) {
      try {
        client.close();
      } catch {}
    }
    appServer.stop(true);
    db.close();
    process.exit(0);
  });
