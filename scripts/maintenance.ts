import { Database } from "bun:sqlite";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { resolve, join } from "node:path";

const [command, argument] = process.argv.slice(2);
const dataDir = resolve(process.env.DATA_DIR || "./data");
const dbPath = join(dataDir, "printroom.sqlite");
if (!existsSync(dbPath) && command !== "restore")
  throw new Error("No Printroom database at " + dbPath);
function database(path = dbPath) {
  const db = new Database(path, { readwrite: true });
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
  return db;
}
if (command === "backup") {
  if (!argument)
    throw new Error(
      "Usage: bun run backup /absolute/backup-directory (stop Printroom first)",
    );
  const destination = resolve(argument);
  if (destination === dataDir || destination.startsWith(dataDir + "/"))
    throw new Error("Choose a backup location outside the data directory");
  if (existsSync(destination))
    throw new Error(
      "Backup destination already exists; choose a new directory",
    );
  mkdirSync(destination, { recursive: true });
  const db = database();
  try {
    // VACUUM INTO creates a consistent SQLite snapshot including committed WAL data.
    db.query("VACUUM INTO ?").run(join(destination, "printroom.sqlite"));
    if (existsSync(join(dataDir, "uploads")))
      cpSync(join(dataDir, "uploads"), join(destination, "uploads"), {
        recursive: true,
      });
    const check = new Database(join(destination, "printroom.sqlite"), {
      readonly: true,
    });
    if (
      (
        check.query("PRAGMA integrity_check").get() as {
          integrity_check: string;
        }
      ).integrity_check !== "ok"
    )
      throw new Error("Backup integrity check failed");
    check.close();
    await Bun.write(
      join(destination, "backup.json"),
      JSON.stringify(
        { created_at: new Date().toISOString(), format: 1 },
        null,
        2,
      ),
    );
    console.log("Backup verified: " + destination);
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  } finally {
    db.close();
  }
} else if (command === "restore") {
  if (!argument)
    throw new Error(
      "Usage: bun run restore /absolute/backup-directory (stop Printroom first; DATA_DIR must be empty)",
    );
  const source = resolve(argument),
    snapshot = join(source, "printroom.sqlite");
  if (!existsSync(snapshot)) throw new Error("Backup database missing");
  if (existsSync(dataDir) && readdirSync(dataDir).length)
    throw new Error(
      "Restore requires an empty DATA_DIR. Keep the old directory as a rollback copy",
    );
  const check = new Database(snapshot, { readonly: true });
  if (
    (check.query("PRAGMA integrity_check").get() as { integrity_check: string })
      .integrity_check !== "ok"
  )
    throw new Error("Backup integrity check failed");
  check.close();
  mkdirSync(dataDir, { recursive: true });
  cpSync(snapshot, dbPath);
  if (existsSync(join(source, "uploads")))
    cpSync(join(source, "uploads"), join(dataDir, "uploads"), {
      recursive: true,
    });
  console.log("Restored: " + dataDir);
} else if (command === "recover-owner") {
  if (!argument)
    throw new Error(
      "Usage: PRINTROOM_RECOVERY_PASSWORD=... bun run recover-owner username (stop Printroom first)",
    );
  const password = process.env.PRINTROOM_RECOVERY_PASSWORD;
  if (!password || password.length > 1024)
    throw new Error(
      "Set PRINTROOM_RECOVERY_PASSWORD to a nonempty password (max 1024 characters)",
    );
  const db = database();
  const user = db
    .query<
      { id: number },
      [string]
    >("SELECT id FROM users WHERE username=? COLLATE NOCASE AND is_admin=1")
    .get(argument);
  if (!user) throw new Error("Owner account not found");
  const hashed = "v2$" + (await Bun.password.hash("printroom-v2:" + password));
  db.transaction(() => {
    db.query("UPDATE users SET password_hash=? WHERE id=?").run(
      hashed,
      user.id,
    );
    db.query("DELETE FROM sessions WHERE user_id=?").run(user.id);
  })();
  db.close();
  console.log(
    "Owner password changed and sessions revoked. Restart Printroom.",
  );
} else if (command === "cleanup-uploads") {
  const db = database();
  const refs = new Set(
    db
      .query<{ image_url: string }, []>(
        "SELECT image_url FROM products UNION SELECT image_url FROM filaments",
      )
      .all()
      .map((r) => r.image_url),
  );
  const uploads = join(dataDir, "uploads");
  let count = 0;
  for (const name of existsSync(uploads) ? readdirSync(uploads) : []) {
    if (
      !/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(name) ||
      refs.has("/uploads/" + name) ||
      Date.now() - statSync(join(uploads, name)).mtimeMs < 86400000
    )
      continue;
    console.log((argument === "--apply" ? "Remove " : "Would remove ") + name);
    if (argument === "--apply") rmSync(join(uploads, name));
    count++;
  }
  db.close();
  console.log(
    `${count} unreferenced images older than 24 hours. Stop Printroom before applying cleanup.`,
  );
} else
  throw new Error("Choose backup, restore, recover-owner or cleanup-uploads");
