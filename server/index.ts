import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import webpush from "web-push";
import { orderStatus, progressStage } from "../shared/order-progress.ts";

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
if (!db.query("PRAGMA table_info(users)").all().some((column: any) => column.name === "is_admin")) db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
if (db.query("SELECT id FROM users LIMIT 1").get() && !db.query("SELECT id FROM users WHERE is_admin=1 LIMIT 1").get()) db.exec("UPDATE users SET is_admin=1 WHERE id=(SELECT MIN(id) FROM users)");
if (!db.query("PRAGMA table_info(orders)").all().some((column: any) => column.name === "is_draft")) {
  db.exec("ALTER TABLE orders ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0");
}
if (!db.query("PRAGMA table_info(orders)").all().some((column: any) => column.name === "confirmed_at")) {
  db.exec("ALTER TABLE orders ADD COLUMN confirmed_at TEXT");
}
if (!db.query("PRAGMA table_info(orders)").all().some((column: any) => column.name === "ship_by")) {
  db.exec("ALTER TABLE orders ADD COLUMN ship_by TEXT NOT NULL DEFAULT ''");
}
if (!db.query("PRAGMA table_info(order_items)").all().some((column: any) => column.name === "status")) {
  db.exec("ALTER TABLE order_items ADD COLUMN status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','printing','printed','shipped'))");
  db.exec("UPDATE order_items SET status=(SELECT CASE orders.status WHEN 'new' THEN 'queued' ELSE orders.status END FROM orders WHERE orders.id=order_items.order_id)");
}
if (!db.query("PRAGMA table_info(order_items)").all().some((column: any) => column.name === "printed_quantity")) {
  db.exec("ALTER TABLE order_items ADD COLUMN printed_quantity INTEGER NOT NULL DEFAULT 0");
  db.exec("UPDATE order_items SET printed_quantity=quantity WHERE status IN ('printed','shipped')");
}
if (!db.query("PRAGMA table_info(order_items)").all().some((column: any) => column.name === "shipped_quantity")) {
  db.exec("ALTER TABLE order_items ADD COLUMN shipped_quantity INTEGER NOT NULL DEFAULT 0");
  db.exec("UPDATE order_items SET shipped_quantity=quantity WHERE status='shipped'");
}
for (const column of ["deadline_soon INTEGER NOT NULL DEFAULT 1", "deadline_overdue INTEGER NOT NULL DEFAULT 1"]) {
  const name = column.split(" ")[0];
  if (!(db.query("PRAGMA table_info(notification_preferences)").all() as { name: string }[]).some(field => field.name === name)) db.exec(`ALTER TABLE notification_preferences ADD COLUMN ${column}`);
}
if (!db.query("PRAGMA table_info(users)").all().some((column: any) => column.name === "username")) {
  db.exec("ALTER TABLE users ADD COLUMN username TEXT");
}
for (const user of db.query("SELECT id,name FROM users WHERE username IS NULL").all() as { id: number; name: string }[]) {
  const base = user.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "user";
  let username = base, suffix = 2;
  while (db.query("SELECT id FROM users WHERE username=? COLLATE NOCASE").get(username)) username = `${base}-${suffix++}`;
  db.query("UPDATE users SET username=? WHERE id=?").run(username, user.id);
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(username COLLATE NOCASE)");
for (const column of ["image_url TEXT NOT NULL DEFAULT ''", "spool_count INTEGER NOT NULL DEFAULT 0", "grams_per_spool REAL NOT NULL DEFAULT 1000"]) {
  const name = column.split(" ")[0];
  if (!(db.query("PRAGMA table_info(filaments)").all() as { name: string }[]).some(field => field.name === name)) db.exec(`ALTER TABLE filaments ADD COLUMN ${column}`);
}
db.query("INSERT OR IGNORE INTO app_settings (key,value) VALUES ('show_money','true'),('currency','GBP')").run();
type Row = Record<string, any>;
const all = (sql: string, ...params: any[]) => db.query(sql).all(...params) as Row[];
const one = (sql: string, ...params: any[]) => db.query(sql).get(...params) as Row | null;
const run = (sql: string, ...params: any[]) => db.query(sql).run(...params);
const json = (value: unknown, status = 200) => Response.json(value, { status });
const bad = (message: string, status = 400) => json({ error: message }, status);
const hash = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
const hashPassword = async (password: string) => "v2$" + await Bun.password.hash("printroom-v2:" + password);
async function verifyPassword(password: string, stored: string) {
  if (stored.startsWith("v2$")) return Bun.password.verify("printroom-v2:" + password, stored.slice(3));
  return Bun.password.verify(password, stored);
}
const itemStatuses = ["queued", "printing", "printed", "shipped"];
let vapidPublic = one("SELECT value FROM app_settings WHERE key='vapid_public'")?.value as string | undefined;
let vapidPrivate = one("SELECT value FROM app_settings WHERE key='vapid_private'")?.value as string | undefined;
if (!vapidPublic || !vapidPrivate) {
  const keys = webpush.generateVAPIDKeys();
  vapidPublic = keys.publicKey;
  vapidPrivate = keys.privateKey;
  run("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('vapid_public',?),('vapid_private',?)", vapidPublic, vapidPrivate);
}
webpush.setVapidDetails("https://github.com/0libote/3D-Print", vapidPublic, vapidPrivate);
type NoticeKind = "draft_created" | "sale_confirmed" | "print_stage" | "order_shipped" | "deadline_soon" | "deadline_overdue";
const noticeKinds: NoticeKind[] = ["draft_created", "sale_confirmed", "print_stage", "order_shipped", "deadline_soon", "deadline_overdue"];
function settings() {
  return {
    show_money: one("SELECT value FROM app_settings WHERE key='show_money'")?.value !== "false",
    currency: one("SELECT value FROM app_settings WHERE key='currency'")?.value || "GBP"
  };
}
function preferences(userId: number) {
  run("INSERT OR IGNORE INTO notification_preferences (user_id) VALUES (?)", userId);
  return one(`SELECT ${noticeKinds.join(",")} FROM notification_preferences WHERE user_id=?`, userId);
}
function activity(actor: Row | null, orderId: number | null, kind: string, detail: string) {
  run("INSERT INTO activity_events (actor_id,actor_name,order_id,kind,detail) VALUES (?,?,?,?,?)", actor?.id ?? null, actor?.name ?? "Printroom", orderId, kind, detail);
}
async function sendNotice(kind: NoticeKind, title: string, message: string, orderId?: number, onlyUserId?: number) {
  const subscribers = all(`SELECT ps.endpoint,ps.subscription_json FROM push_subscriptions ps JOIN notification_preferences np ON np.user_id=ps.user_id WHERE np.${kind}=1${onlyUserId ? " AND ps.user_id=?" : ""}`, ...(onlyUserId ? [onlyUserId] : []));
  await Promise.all(subscribers.map(async subscriber => {
    try {
      await webpush.sendNotification(JSON.parse(subscriber.subscription_json), JSON.stringify({ title, body: message, url: orderId ? `/?order=${orderId}` : "/" }), { TTL: 3600, urgency: "normal" });
    } catch (error: any) {
      if (error?.statusCode === 404 || error?.statusCode === 410) run("DELETE FROM push_subscriptions WHERE endpoint=?", subscriber.endpoint);
      else console.error("Push delivery failed:", error?.message || error);
    }
  }));
}
function notify(kind: NoticeKind, title: string, message: string, orderId?: number) {
  void sendNotice(kind, title, message, orderId).catch(error => console.error("Notification failed:", error));
}
function sessionToken(req: Request) {
  return new Bun.CookieMap(req.headers.get("cookie") ?? "").get("session");
}
function cookie(req: Request, token: string, maxAge: number) {
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  return new Bun.Cookie("session", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge,
    secure,
  }).serialize();
}
function userFrom(req: Request) {
  const token = sessionToken(req);
  if (!token) return null;
  return one("SELECT users.id, users.name, users.username, users.is_admin FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>datetime('now')", hash(token));
}
function username(value: unknown) {
  const text = required(value, "Username", 64);
  if (!/^[a-zA-Z0-9._-]+$/.test(text)) throw new Error("Username can contain letters, numbers, dots, underscores and hyphens");
  return text;
}
async function body(req: Request): Promise<Row> {
  try { return await req.json() as Row; } catch { throw new Error("Invalid JSON body"); }
}
function required(value: unknown, label: string, limit = 200) {
  const text = String(value ?? "").trim();
  if (!text || text.length > limit) throw new Error(`${label} is required (max ${limit} characters)`);
  return text;
}
function optional(value: unknown, limit = 2000) {
  const text = String(value ?? "").trim();
  if (text.length > limit) throw new Error(`Text is too long (max ${limit} characters)`);
  return text;
}
function shipBy(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text) throw new Error("Choose a valid ship-by date");
  return text;
}
function id(value: string | undefined) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error("Invalid ID");
  return n;
}
function filamentStock(b: Row) {
  const count = Number(b.spool_count ?? 0), grams = Number(b.grams_per_spool ?? 1000);
  if (!Number.isSafeInteger(count) || count < 0 || count > 100000) throw new Error("Spool count must be a whole number between 0 and 100,000");
  if (!Number.isFinite(grams) || grams < 0 || grams > 100000) throw new Error("Grams per spool must be between 0 and 100,000");
  return { count, grams };
}
function productRows() {
  return all("SELECT * FROM products ORDER BY id DESC").map(p => ({
    ...p,
    filament_ids: all("SELECT filament_id FROM product_filaments WHERE product_id=?", p.id).map(r => r.filament_id)
  }));
}
function orderRows() {
  return all("SELECT * FROM orders ORDER BY id DESC").map(o => ({
    ...o,
    status: o.is_draft ? "draft" : o.status,
    items: all("SELECT * FROM order_items WHERE order_id=? ORDER BY id", o.id)
  }));
}
function updateOrderStatus(orderId: number) {
  const order = one("SELECT is_draft FROM orders WHERE id=?", orderId);
  if (!order || order.is_draft) return;
  const items = all("SELECT status FROM order_items WHERE order_id=?", orderId);
  const status = orderStatus(items.map(item => item.status));
  run("UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", status, orderId);
}
function quantity(value: unknown, label: string, min: number, max: number) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return number;
}
function itemProduct(b: Row) {
  const productId = id(String(b.product_id));
  const product = one("SELECT * FROM products WHERE id=?", productId);
  if (!product) throw new Error("Product not found");
  const filamentId = b.filament_id ? id(String(b.filament_id)) : null;
  const filament = filamentId ? one("SELECT f.* FROM filaments f JOIN product_filaments pf ON pf.filament_id=f.id WHERE pf.product_id=? AND f.id=?", productId, filamentId) : null;
  if (filamentId && !filament) throw new Error("That filament is not offered for this product");
  return { productId, product, filamentId, filament };
}
function checkDeadlineReminders() {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TZ || "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map(part => [part.type, part.value]));
  if (Number(parts.hour) < 9) return;
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const todayDay = Date.parse(today) / 86400000;
  let changed = false;
  for (const order of all("SELECT id,customer,ship_by FROM orders WHERE is_draft=0 AND status<>'shipped' AND ship_by<>''")) {
    const days = Date.parse(order.ship_by) / 86400000 - todayDay;
    if (days > 2) continue;
    const overdue = days < 0;
    const kind = overdue ? "deadline_overdue" : "deadline_soon";
    const result = run("INSERT OR IGNORE INTO deadline_reminders (order_id,kind,ship_by) VALUES (?,?,?)", order.id, kind, order.ship_by);
    if (!result.changes) continue;
    const detail = overdue ? `Order #${order.id} for ${order.customer} is overdue (ship by ${order.ship_by}).` : `Order #${order.id} for ${order.customer} is due to ship ${days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`} (${order.ship_by}).`;
    activity(null, order.id, kind, detail);
    notify(kind, overdue ? "Shipping deadline overdue" : "Shipping deadline approaching", detail, order.id);
    changed = true;
  }
  if (changed) broadcastChange();
}
const port = Number(process.env.PORT || 3000);
const liveClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const liveEncoder = new TextEncoder();
function sendLive(chunk: Uint8Array) {
  for (const client of liveClients) {
    try { if ((client.desiredSize ?? 0) > 0) client.enqueue(chunk); }
    catch { liveClients.delete(client); }
  }
}
function broadcastChange() { sendLive(liveEncoder.encode(`data: ${Date.now()}\n\n`)); }
setInterval(() => sendLive(liveEncoder.encode(": ping\n\n")), 20_000);
function liveResponse() {
  let client: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { client = controller; liveClients.add(controller); controller.enqueue(liveEncoder.encode(": connected\n\n")); },
    cancel() { liveClients.delete(client); }
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
async function handleRequest(req: Request, server: { timeout: (req: Request, seconds: number) => void }): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (!path.startsWith("/api/")) {
      const root = resolve("./dist");
      const relative = path.slice(1);
      const file = resolve(root, relative || "index.html");
      if (!file.startsWith(root + "/") && file !== root) return bad("Not found", 404);
      let selected = Bun.file(file);
      if (!(await selected.exists())) selected = Bun.file(join(root, "index.html"));
      if (!(await selected.exists())) return bad("Not found", 404);
      return new Response(selected);
    }
    if (req.method !== "GET") {
      const origin = req.headers.get("origin");
      if (origin && new URL(origin).host !== url.host) return bad("Invalid request origin", 403);
    }
    try {
      if (path === "/api/bootstrap" && req.method === "GET") {
        const user = userFrom(req);
        return json({ needsSetup: !one("SELECT id FROM users LIMIT 1"), user, users: user?.is_admin ? all("SELECT id,name,username,is_admin,created_at FROM users ORDER BY id") : [], settings: settings(), notifications: user ? { preferences: preferences(user.id), vapidPublicKey: vapidPublic, subscribed: !!one("SELECT endpoint FROM push_subscriptions WHERE user_id=? LIMIT 1", user.id) } : null, filaments: user ? all("SELECT * FROM filaments ORDER BY name") : [], products: user ? productRows() : [], orders: user ? orderRows() : [], activity: user ? all("SELECT * FROM activity_events ORDER BY id DESC LIMIT 100") : [] });
      }
      if (path === "/api/setup" && req.method === "POST") {
        if (one("SELECT id FROM users LIMIT 1")) return bad("Setup is already complete", 409);
        const b = await body(req);
        const name = required(b.name, "Name", 100), login = username(b.username);
        const password = String(b.password ?? "");
        const passwordHash = await hashPassword(password);
        const token = randomHex(32);
        const created = db.transaction(() => {
          if (one("SELECT id FROM users LIMIT 1")) return false;
          const result = run("INSERT INTO users (name,username,email,password_hash,is_admin) VALUES (?,?,?,?,1)", name, login, `user-${randomHex(12)}@local.invalid`, passwordHash);
          run("INSERT INTO sessions VALUES (?,?,datetime('now','+30 days'))", hash(token), result.lastInsertRowid);
          return true;
        })();
        if (!created) return bad("Setup is already complete", 409);
        return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "Content-Type": "application/json", "Set-Cookie": cookie(req, token, 2592000) } });
      }
      if (path === "/api/login" && req.method === "POST") {
        const b = await body(req);
        const login = String(b.username ?? b.email ?? "").trim();
        const user = one("SELECT * FROM users WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE", login, login);
        if (!user || !await verifyPassword(String(b.password ?? ""), user.password_hash)) return bad("Incorrect username or password", 401);
        const token = randomHex(32);
        run("INSERT INTO sessions VALUES (?,?,datetime('now','+30 days'))", hash(token), user.id);
        return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Set-Cookie": cookie(req, token, 2592000) } });
      }
      if (path === "/api/logout" && req.method === "POST") {
        const token = sessionToken(req);
        if (token) run("DELETE FROM sessions WHERE token_hash=?", hash(token));
        return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Set-Cookie": cookie(req, "", 0) } });
      }
      const currentUser = userFrom(req);
      if (!currentUser) return bad("Please sign in", 401);
      if (path === "/api/events" && req.method === "GET") {
        server.timeout(req, 0);
        return liveResponse();
      }
      if (path === "/api/users" && req.method === "GET") {
        if (!currentUser.is_admin) return bad("Admin access required", 403);
        return json(all("SELECT id,name,username,is_admin,created_at FROM users ORDER BY id"));
      }
      if (path === "/api/users" && req.method === "POST") {
        if (!currentUser.is_admin) return bad("Admin access required", 403);
        const b = await body(req), login = username(b.username), password = String(b.password ?? "");
        if (one("SELECT id FROM users WHERE username=? COLLATE NOCASE", login)) return bad("That username is already in use", 409);
        run("INSERT INTO users (name,username,email,password_hash) VALUES (?,?,?,?)", required(b.name, "Name", 100), login, `user-${randomHex(12)}@local.invalid`, await hashPassword(password));
        return json({ ok: true }, 201);
      }
      const userPassword = path.match(/^\/api\/users\/(\d+)\/password$/);
      if (userPassword && req.method === "PUT") {
        if (!currentUser.is_admin) return bad("Admin access required", 403);
        const targetId = id(userPassword[1]);
        if (!one("SELECT id FROM users WHERE id=?", targetId)) return bad("User not found", 404);
        const b = await body(req);
        if (typeof b.password !== "string") return bad("Password is required");
        const passwordHash = await hashPassword(b.password);
        db.transaction(() => {
          run("UPDATE users SET password_hash=? WHERE id=?", passwordHash, targetId);
          if (targetId === currentUser.id) {
            const token = req.headers.get("cookie")?.match(/(?:^|; )session=([^;]+)/)?.[1];
            run("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", targetId, hash(token || ""));
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
        if (targetId === currentUser.id) return bad("You cannot delete your own account", 409);
        if (target.is_admin && !one("SELECT id FROM users WHERE is_admin=1 AND id<>? LIMIT 1", targetId)) return bad("The last owner cannot be deleted", 409);
        run("DELETE FROM users WHERE id=?", targetId);
        return json({ ok: true });
      }
      if (path === "/api/settings" && req.method === "PUT") {
        if (!currentUser.is_admin) return bad("Admin access required", 403);
        const b = await body(req);
        const currency = String(b.currency ?? "").trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) return bad("Choose a three-letter currency code");
        try { new Intl.NumberFormat("en", { style: "currency", currency }); }
        catch { return bad("Unsupported currency code"); }
        run("UPDATE app_settings SET value=? WHERE key='show_money'", b.show_money ? "true" : "false");
        run("UPDATE app_settings SET value=? WHERE key='currency'", currency);
        return json({ ok: true });
      }
      if (path === "/api/notification-preferences" && req.method === "PUT") {
        const b = await body(req);
        if (noticeKinds.some(kind => typeof b[kind] !== "boolean")) return bad("Invalid notification preferences");
        preferences(currentUser.id);
        run(`UPDATE notification_preferences SET ${noticeKinds.map(kind => `${kind}=?`).join(",")} WHERE user_id=?`, ...noticeKinds.map(kind => b[kind] ? 1 : 0), currentUser.id);
        return json({ ok: true });
      }
      if (path === "/api/push-subscriptions" && req.method === "POST") {
        const b = await body(req), subscription = b.subscription;
        const endpoint = String(subscription?.endpoint ?? "");
        if (endpoint.length > 2048 || !endpoint.startsWith("https://") || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return bad("Invalid push subscription");
        run("INSERT INTO push_subscriptions (endpoint,user_id,subscription_json) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription_json=excluded.subscription_json", endpoint, currentUser.id, JSON.stringify(subscription));
        return json({ ok: true }, 201);
      }
      if (path === "/api/push-subscriptions" && req.method === "DELETE") {
        const b = await body(req);
        run("DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?", String(b.endpoint ?? ""), currentUser.id);
        return json({ ok: true });
      }
      if (path === "/api/notifications/test" && req.method === "POST") {
        const subscriptions = all("SELECT endpoint,subscription_json FROM push_subscriptions WHERE user_id=?", currentUser.id);
        if (!subscriptions.length) return bad("Enable notifications on this device first");
        const delivered = await Promise.all(subscriptions.map(async subscription => {
          try {
            await webpush.sendNotification(JSON.parse(subscription.subscription_json), JSON.stringify({ title: "Printroom notifications are ready", body: "You'll hear from your studio when the events you selected happen.", url: "/" }), { TTL: 300 });
            return true;
          } catch (error: any) {
            if (error?.statusCode === 404 || error?.statusCode === 410) run("DELETE FROM push_subscriptions WHERE endpoint=?", subscription.endpoint);
            console.error("Test push failed:", error?.message || error);
            return false;
          }
        }));
        if (!delivered.some(Boolean)) return bad("The push service rejected the test. Try enabling notifications again.", 502);
        return json({ ok: true });
      }
      if (path === "/api/filaments" && req.method === "POST") {
        const b = await body(req);
        const color = String(b.color ?? "");
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) return bad("Choose a valid colour");
        const stock = filamentStock(b);
        run("INSERT INTO filaments (name,brand,material,color,notes,image_url,spool_count,grams_per_spool) VALUES (?,?,?,?,?,?,?,?)", required(b.name, "Filament name"), optional(b.brand, 100), required(b.material, "Material", 50), color, optional(b.notes), optional(b.image_url, 500), stock.count, stock.grams);
        return json({ ok: true }, 201);
      }
      const filament = path.match(/^\/api\/filaments\/(\d+)$/);
      if (filament && req.method === "PUT") {
        const b = await body(req), color = String(b.color ?? "");
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) return bad("Choose a valid colour");
        const stock = filamentStock(b);
        run("UPDATE filaments SET name=?,brand=?,material=?,color=?,notes=?,image_url=?,spool_count=?,grams_per_spool=? WHERE id=?", required(b.name, "Filament name"), optional(b.brand, 100), required(b.material, "Material", 50), color, optional(b.notes), optional(b.image_url, 500), stock.count, stock.grams, id(filament[1]));
        return json({ ok: true });
      }
      const filamentStockPath = path.match(/^\/api\/filaments\/(\d+)\/stock$/);
      if (filamentStockPath && req.method === "PUT") {
        const b = await body(req), stock = filamentStock(b), filamentId = id(filamentStockPath[1]);
        if (!one("SELECT id FROM filaments WHERE id=?", filamentId)) return bad("Filament not found", 404);
        run("UPDATE filaments SET spool_count=?,grams_per_spool=? WHERE id=?", stock.count, stock.grams, filamentId);
        return json({ ok: true });
      }
      if (filament && req.method === "DELETE") { run("DELETE FROM filaments WHERE id=?", id(filament[1])); return json({ ok: true }); }
      if (path === "/api/products" && req.method === "POST") {
        const b = await body(req), price = Number(b.price ?? 0);
        if (!Number.isFinite(price) || price < 0) return bad("Price must be zero or more");
        const ids = Array.isArray(b.filament_ids) ? b.filament_ids.map(Number) : [];
        const tx = db.transaction(() => {
          const result = run("INSERT INTO products (name,description,image_url,price) VALUES (?,?,?,?)", required(b.name, "Product name"), optional(b.description), optional(b.image_url, 500), price);
          for (const filamentId of new Set(ids)) run("INSERT INTO product_filaments VALUES (?,?)", result.lastInsertRowid, filamentId);
        });
        tx();
        return json({ ok: true }, 201);
      }
      const product = path.match(/^\/api\/products\/(\d+)$/);
      if (product && req.method === "PUT") {
        const b = await body(req), price = Number(b.price ?? 0), productId = id(product[1]);
        if (!Number.isFinite(price) || price < 0) return bad("Price must be zero or more");
        const ids = Array.isArray(b.filament_ids) ? b.filament_ids.map(Number) : [];
        db.transaction(() => {
          run("UPDATE products SET name=?,description=?,image_url=?,price=? WHERE id=?", required(b.name, "Product name"), optional(b.description), optional(b.image_url, 500), price, productId);
          run("DELETE FROM product_filaments WHERE product_id=?", productId);
          for (const filamentId of new Set(ids)) run("INSERT INTO product_filaments VALUES (?,?)", productId, filamentId);
        })();
        return json({ ok: true });
      }
      if (product && req.method === "DELETE") { run("DELETE FROM products WHERE id=?", id(product[1])); return json({ ok: true }); }
      if (path === "/api/upload" && req.method === "POST") {
        const form = await req.formData(), file = form.get("file");
        if (!(file instanceof File) || file.size > 5_000_000 || file.size < 1 || !["image/png","image/jpeg","image/webp"].includes(file.type)) return bad("Upload a PNG, JPEG or WebP image under 5 MB");
        const extension = { "image/png":".png", "image/jpeg":".jpg", "image/webp":".webp" }[file.type];
        const filename = randomHex(16) + extension;
        await Bun.write(join(uploadDir, filename), file);
        return json({ url: "/uploads/" + filename }, 201);
      }
      if (path === "/api/orders" && req.method === "POST") {
        const b = await body(req);
        const result = run("INSERT INTO orders (customer,contact,notes,ship_by,is_draft) VALUES (?,?,?,?,1)", required(b.customer, "Customer"), optional(b.contact, 200), optional(b.notes), shipBy(b.ship_by));
        activity(currentUser, Number(result.lastInsertRowid), "draft_created", `Created draft for ${String(b.customer).trim()}.`);
        notify("draft_created", "New draft order", `Order #${result.lastInsertRowid} for ${String(b.customer).trim()} was created.`, Number(result.lastInsertRowid));
        return json({ ok: true, id: Number(result.lastInsertRowid) }, 201);
      }
      const order = path.match(/^\/api\/orders\/(\d+)$/);
      if (order && req.method === "PUT") {
        const b = await body(req);
        const orderId = id(order[1]), existing = one("SELECT * FROM orders WHERE id=?", orderId);
        if (!existing) return bad("Order not found", 404);
        const deadline = shipBy(b.ship_by);
        run("UPDATE orders SET customer=?,contact=?,notes=?,ship_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", required(b.customer, "Customer"), optional(b.contact, 200), optional(b.notes), deadline, orderId);
        activity(currentUser, orderId, "order_updated", existing.ship_by !== deadline ? `Updated order details and ship-by date to ${deadline || "none"}.` : "Updated order details.");
        setTimeout(checkDeadlineReminders, 1000);
        return json({ ok: true });
      }
      const confirm = path.match(/^\/api\/orders\/(\d+)\/confirm$/);
      if (confirm && req.method === "POST") {
        const orderId = id(confirm[1]);
        const existing = one("SELECT is_draft FROM orders WHERE id=?", orderId);
        if (!existing) return bad("Order not found", 404);
        if (!existing.is_draft) return bad("This order is already confirmed", 409);
        if (!one("SELECT id FROM order_items WHERE order_id=? LIMIT 1", orderId)) return bad("Add at least one print item before confirming this sale");
        run("UPDATE orders SET is_draft=0,confirmed_at=CURRENT_TIMESTAMP,status='new',updated_at=CURRENT_TIMESTAMP WHERE id=?", orderId);
        activity(currentUser, orderId, "sale_confirmed", "Confirmed the sale and added its items to the print queue.");
        notify("sale_confirmed", "Sale confirmed", `Order #${orderId} is ready to fulfill.`, orderId);
        setTimeout(checkDeadlineReminders, 1000);
        return json({ ok: true });
      }
      if (order && req.method === "DELETE") { const orderId = id(order[1]); if (!one("SELECT id FROM orders WHERE id=?", orderId)) return bad("Order not found", 404); activity(currentUser, orderId, "order_deleted", `Deleted order #${orderId}.`); run("DELETE FROM orders WHERE id=?", orderId); return json({ ok: true }); }
      const items = path.match(/^\/api\/orders\/(\d+)\/items$/);
      if (items && req.method === "POST") {
        const b = await body(req), orderId = id(items[1]);
        if (!one("SELECT id FROM orders WHERE id=?", orderId)) return bad("Order not found", 404);
        const { productId, product, filamentId, filament } = itemProduct(b);
        const count = quantity(b.quantity, "Quantity", 1, 10000);
        run("INSERT INTO order_items (order_id,product_id,product_name,filament_id,filament_name,color,quantity,unit_price,status) VALUES (?,?,?,?,?,?,?,?,?)", orderId, productId, product.name, filamentId, filament?.name ?? "", filament?.color ?? "#adb5bd", count, product.price, "queued");
        activity(currentUser, orderId, "item_added", `Added ${count} × ${product.name}${filament ? ` in ${filament.name}` : ""}.`);
        updateOrderStatus(orderId);
        run("UPDATE orders SET updated_at=CURRENT_TIMESTAMP WHERE id=?", orderId);
        return json({ ok: true }, 201);
      }
      const itemStatus = path.match(/^\/api\/items\/(\d+)\/status$/);
      if (itemStatus && req.method === "PUT") {
        const b = await body(req), status = String(b.status ?? "");
        if (!itemStatuses.includes(status)) return bad("Invalid print stage");
        const itemId = id(itemStatus[1]);
        const existing = one("SELECT order_items.*,orders.is_draft FROM order_items JOIN orders ON orders.id=order_items.order_id WHERE order_items.id=?", itemId);
        if (!existing) return bad("Item not found", 404);
        if (existing.is_draft) return bad("Confirm the sale before moving print items", 409);
        const before = one("SELECT status FROM orders WHERE id=?", existing.order_id)?.status;
        const printed = status === "printed" || status === "shipped" ? existing.quantity : 0;
        const shipped = status === "shipped" ? existing.quantity : 0;
        run("UPDATE order_items SET status=?,printed_quantity=?,shipped_quantity=? WHERE id=?", status, printed, shipped, itemId);
        updateOrderStatus(existing.order_id);
        const after = one("SELECT status FROM orders WHERE id=?", existing.order_id)?.status;
        if (existing.status !== status || existing.printed_quantity !== printed || existing.shipped_quantity !== shipped) {
          activity(currentUser, existing.order_id, "print_stage", `Moved ${existing.product_name} to ${status} (${printed} printed, ${shipped} shipped of ${existing.quantity}).`);
          notify("print_stage", "Print stage updated", `${existing.product_name} in order #${existing.order_id} is now ${status}.`, existing.order_id);
          if (before !== "shipped" && after === "shipped") notify("order_shipped", "Order shipped", `All items in order #${existing.order_id} have shipped.`, existing.order_id);
        }
        return json({ ok: true });
      }
      const itemProgress = path.match(/^\/api\/items\/(\d+)\/progress$/);
      if (itemProgress && req.method === "POST") {
        const b = await body(req), itemId = id(itemProgress[1]);
        if (!["print_one", "ship_one"].includes(b.action)) return bad("Choose print one or ship one");
        const result = db.transaction(() => {
          const item = one("SELECT order_items.*,orders.is_draft FROM order_items JOIN orders ON orders.id=order_items.order_id WHERE order_items.id=?", itemId);
          if (!item) return { error: "Item not found", status: 404 };
          if (item.is_draft) return { error: "Confirm the sale before moving print items", status: 409 };
          const printed = item.printed_quantity + (b.action === "print_one" ? 1 : 0);
          const shipped = item.shipped_quantity + (b.action === "ship_one" ? 1 : 0);
          if (printed > item.quantity) return { error: "All pieces are already printed", status: 409 };
          if (shipped > printed) return { error: "Print another piece before shipping it", status: 409 };
          const before = one("SELECT status FROM orders WHERE id=?", item.order_id)?.status;
          const stage = progressStage(item.quantity, printed, shipped, item.status);
          run("UPDATE order_items SET printed_quantity=?,shipped_quantity=?,status=? WHERE id=?", printed, shipped, stage, itemId);
          updateOrderStatus(item.order_id);
          activity(currentUser, item.order_id, b.action, `${b.action === "print_one" ? "Printed" : "Shipped"} one ${item.product_name} (${printed} printed, ${shipped} shipped of ${item.quantity}).`);
          const after = one("SELECT status FROM orders WHERE id=?", item.order_id)?.status;
          return { item, stage, before, after };
        })();
        if ("error" in result) return bad(result.error!, result.status);
        notify("print_stage", "Print progress updated", `${result.item.product_name} in order #${result.item.order_id}: ${result.stage}.`, result.item.order_id);
        if (result.before !== "shipped" && result.after === "shipped") notify("order_shipped", "Order shipped", `All items in order #${result.item.order_id} have shipped.`, result.item.order_id);
        return json({ ok: true });
      }
      const item = path.match(/^\/api\/items\/(\d+)$/);
      if (item && req.method === "PUT") {
        const b = await body(req), itemId = id(item[1]);
        const existing = one("SELECT * FROM order_items WHERE id=?", itemId);
        if (!existing) return bad("Item not found", 404);
        const { productId, product, filamentId, filament } = itemProduct(b);
        const count = quantity(b.quantity, "Quantity", 1, 10000);
        const printed = quantity(b.printed_quantity, "Printed count", 0, count);
        const shipped = quantity(b.shipped_quantity, "Shipped count", 0, printed);
        const stage = progressStage(count, printed, shipped, existing.status);
        const before = one("SELECT status FROM orders WHERE id=?", existing.order_id)?.status;
        run("UPDATE order_items SET product_id=?,product_name=?,filament_id=?,filament_name=?,color=?,quantity=?,unit_price=?,printed_quantity=?,shipped_quantity=?,status=? WHERE id=?", productId, product.name, filamentId, filament?.name ?? "", filament?.color ?? "#adb5bd", count, existing.product_id === productId ? existing.unit_price : product.price, printed, shipped, stage, itemId);
        updateOrderStatus(existing.order_id);
        activity(currentUser, existing.order_id, "item_updated", `Updated ${product.name}: ${count} ordered, ${printed} printed, ${shipped} shipped${filament ? ` in ${filament.name}` : ""}.`);
        const after = one("SELECT status FROM orders WHERE id=?", existing.order_id)?.status;
        if (before !== "shipped" && after === "shipped") notify("order_shipped", "Order shipped", `All items in order #${existing.order_id} have shipped.`, existing.order_id);
        return json({ ok: true });
      }
      if (item && req.method === "DELETE") {
        const itemId = id(item[1]);
        const existing = one("SELECT order_id,product_name FROM order_items WHERE id=?", itemId);
        if (!existing) return bad("Item not found", 404);
        run("DELETE FROM order_items WHERE id=?", itemId);
        activity(currentUser, existing.order_id, "item_deleted", `Removed ${existing.product_name} from the order.`);
        updateOrderStatus(existing.order_id);
        run("UPDATE orders SET updated_at=CURRENT_TIMESTAMP WHERE id=?", existing.order_id);
        return json({ ok: true });
      }
      return bad("Not found", 404);
    } catch (error) {
      console.error(error);
      return bad(error instanceof Error ? error.message : "Something went wrong");
    }
}
Bun.serve({
  port,
  routes: {
    "/uploads/*": { dir: uploadDir },
  },
  async fetch(req, server) {
    const response = await handleRequest(req, server);
    const path = new URL(req.url).pathname;
    if (response.ok && req.method !== "GET" && path.startsWith("/api/") && !["/api/logout", "/api/notifications/test", "/api/push-subscriptions"].includes(path)) broadcastChange();
    return response;
  }
});
setTimeout(checkDeadlineReminders, 2000);
setInterval(checkDeadlineReminders, 15 * 60 * 1000);
console.log(`Printroom listening on :${port}`);
