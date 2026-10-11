import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
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
