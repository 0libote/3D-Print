import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("backup/restore includes committed WAL data, uploads, push keys and owner recovery", async () => {
  const root = mkdtempSync(join(tmpdir(), "printroom-maintenance-")),
    data = join(root, "data"),
    backup = join(root, "backup"),
    restored = join(root, "restored");
  mkdirSync(join(data, "uploads"), { recursive: true });
  await Bun.write(join(data, "uploads", "photo.png"), "example bytes");
  const db = new Database(join(data, "printroom.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE app_settings(key TEXT,value TEXT); INSERT INTO app_settings VALUES('vapid_private','test-push-key'); CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,is_admin INTEGER,password_hash TEXT); INSERT INTO users VALUES(1,'owner',1,'old'); CREATE TABLE sessions(token_hash TEXT,user_id INTEGER); INSERT INTO sessions VALUES('old-session',1);",
  );
  const run = async (
    command: string,
    argument: string,
    dir: string,
    extra: Record<string, string> = {},
  ) => {
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        resolve("scripts/maintenance.ts"),
        command,
        argument,
      ],
      {
        env: { ...process.env, DATA_DIR: dir, ...extra },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const status = await child.exited;
    const error = await new Response(child.stderr).text();
    if (status) throw new Error(error);
    return new Response(child.stdout).text();
  };
  try {
    expect(await run("backup", backup, data)).toContain("Backup verified");
    db.close();
    expect(await run("restore", backup, restored)).toContain("Restored");
    expect(readFileSync(join(restored, "uploads", "photo.png"), "utf8")).toBe(
      "example bytes",
    );
    const check = new Database(join(restored, "printroom.sqlite"));
    expect(check.query("SELECT value FROM app_settings").get()).toEqual({
      value: "test-push-key",
    });
    check.close();
    await run("recover-owner", "owner", restored, {
      PRINTROOM_RECOVERY_PASSWORD: "new-password",
    });
    const recovered = new Database(join(restored, "printroom.sqlite"));
    const user = recovered
      .query<{ password_hash: string }, []>("SELECT password_hash FROM users")
      .get()!;
    expect(
      await Bun.password.verify(
        "printroom-v2:new-password",
        user.password_hash.slice(3),
      ),
    ).toBe(true);
    expect(
      recovered.query("SELECT COUNT(*) AS count FROM sessions").get(),
    ).toEqual({ count: 0 });
    recovered.close();
    await expect(run("restore", backup, restored)).rejects.toThrow(
      "empty DATA_DIR",
    );
  } finally {
    try {
      db.close();
    } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup-uploads dry-run only lists while --apply removes unreferenced old images", async () => {
  const root = mkdtempSync(join(tmpdir(), "printroom-cleanup-")),
    data = join(root, "data"),
    uploads = join(data, "uploads");
  mkdirSync(uploads, { recursive: true });
  const referenced = "a".repeat(32) + ".png",
    orphan = "b".repeat(32) + ".jpg",
    recent = "c".repeat(32) + ".webp";
  const seed = new Database(join(data, "printroom.sqlite"));
  seed.exec(
    "CREATE TABLE products(image_url TEXT); CREATE TABLE filaments(image_url TEXT);",
  );
  seed.query("INSERT INTO products VALUES(?)").run("/uploads/" + referenced);
  seed.close();
  const old = new Date(Date.now() - 25 * 3600 * 1000);
  for (const [name, mtime] of [
    [referenced, old],
    [orphan, old],
    [recent, new Date()],
    ["photo.png", old],
  ] as const) {
    writeFileSync(join(uploads, name), "bytes");
    utimesSync(join(uploads, name), mtime, mtime);
  }
  const run = async (extra: string[]) => {
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        resolve("scripts/maintenance.ts"),
        "cleanup-uploads",
        ...extra,
      ],
      {
        env: { ...process.env, DATA_DIR: data },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const status = await child.exited;
    const output =
      (await new Response(child.stdout).text()) +
      (await new Response(child.stderr).text());
    if (status) throw new Error(output);
    return output;
  };
  try {
    const dry = await run([]);
    expect(dry).toContain("Would remove " + orphan);
    expect(dry).not.toContain(referenced);
    expect(dry).not.toContain(recent);
    expect(dry).toContain("1 unreferenced images");
    expect(existsSync(join(uploads, orphan))).toBe(true);
    const applied = await run(["--apply"]);
    expect(applied).toContain("Remove " + orphan);
    expect(existsSync(join(uploads, orphan))).toBe(false);
    expect(existsSync(join(uploads, referenced))).toBe(true);
    expect(existsSync(join(uploads, recent))).toBe(true);
    expect(existsSync(join(uploads, "photo.png"))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// TODO: extract the pure deadline kind/detail computation out of
// checkDeadlineReminders (server/index.ts) into shared/ so it can be unit
// tested here without a database. Kept skipped until that extraction lands.
test.skip("dueReminders pure helper", () => {});
