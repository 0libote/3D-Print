import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let dir: string, port: number, owner: string;
let child: ReturnType<typeof Bun.spawn>;
async function request(
  path: string,
  method = "GET",
  value?: unknown,
  cookie = owner,
) {
  return fetch(`http://localhost:${port}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie || "" },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
}
async function waitForFile(name: string) {
  for (let i = 0; i < 300; i++) {
    if (existsSync(join(dir, name))) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for ${name}`);
}
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "printroom-auth-races-"));
  // Pause real password work at its completion, so resets cross the exact await.
  const preload = join(dir, "password-gate.js");
  await Bun.write(
    preload,
    `
    const verify = Bun.password.verify;
    const hash = Bun.password.hash;
    async function gate(name) {
      await Bun.write(${JSON.stringify(dir)} + '/' + name + '-ready', '');
      while (!(await Bun.file(${JSON.stringify(dir)} + '/' + name + '-release').exists()))
        await Bun.sleep(5);
    }
    Bun.password.verify = async (...args) => {
      const result = await verify(...args);
      if (args[0] === 'printroom-v2:paused-login') await gate('login');
      return result;
    };
    Bun.password.hash = async (...args) => {
      const result = await hash(...args);
      if (args[0] === 'printroom-v2:paused-change') await gate('change');
      if (args[0] === 'printroom-v2:paused-admin-reset') await gate('admin');
      return result;
    };
  `,
  );
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
  port = reservation.port!;
  reservation.stop(true);
  child = Bun.spawn(
    [process.execPath, "--preload", preload, resolve("server/index.ts")],
    {
      env: { ...process.env, DATA_DIR: dir, PORT: String(port) },
      stdout: "ignore",
      stderr: "ignore",
    },
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await request("/bootstrap")).ok) break;
    } catch {}
    await Bun.sleep(30);
  }
  const setup = await request("/setup", "POST", {
    name: "Owner",
    username: "owner",
    password: "owner-password",
  });
  expect(setup.status).toBe(201);
  owner = setup.headers.get("set-cookie")!.split(";")[0];
});
afterAll(async () => {
  child?.kill();
  if (child) await child.exited;
  if (dir) rmSync(dir, { recursive: true, force: true });
});
async function createMember(username: string, password: string) {
  expect(
    (await request("/users", "POST", { name: username, username, password }))
      .status,
  ).toBe(201);
  const users = await (await request("/users")).json();
  return users.find((user: any) => user.username === username).id;
}

test("a login verified before an owner reset cannot create a session afterward", async () => {
  const id = await createMember("login-race", "paused-login");
  const pending = request(
    "/login",
    "POST",
    { username: "login-race", password: "paused-login" },
    "",
  );
  try {
    await waitForFile("login-ready");
    expect(
      (
        await request(`/users/${id}/password`, "PUT", {
          password: "reset-password",
        })
      ).status,
    ).toBe(200);
  } finally {
    await Bun.write(join(dir, "login-release"), "");
  }
  const response = await pending;
  expect(response.status).toBe(401);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(
    (
      await request(
        "/login",
        "POST",
        { username: "login-race", password: "reset-password" },
        "",
      )
    ).status,
  ).toBe(200);
});

test("a pending self-service password change cannot overwrite an owner reset", async () => {
  const id = await createMember("change-race", "original-password");
  const login = await request(
    "/login",
    "POST",
    { username: "change-race", password: "original-password" },
    "",
  );
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const pending = request(
    "/account/password",
    "PUT",
    { current_password: "original-password", password: "paused-change" },
    cookie,
  );
  try {
    await waitForFile("change-ready");
    expect(
      (
        await request(`/users/${id}/password`, "PUT", {
          password: "reset-password",
        })
      ).status,
    ).toBe(200);
  } finally {
    await Bun.write(join(dir, "change-release"), "");
  }
  expect((await pending).status).toBe(401);
  expect(
    (await (await request("/bootstrap", "GET", undefined, cookie)).json()).user,
  ).toBeNull();
  expect(
    (
      await request(
        "/login",
        "POST",
        { username: "change-race", password: "reset-password" },
        "",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await request(
        "/login",
        "POST",
        { username: "change-race", password: "paused-change" },
        "",
      )
    ).status,
  ).toBe(401);
});

test("an owner password reset cannot commit after its session is revoked", async () => {
  const id = await createMember("admin-race", "original-password");
  const login = await request(
    "/login",
    "POST",
    { username: "owner", password: "owner-password" },
    "",
  );
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const pending = request(
    `/users/${id}/password`,
    "PUT",
    { password: "paused-admin-reset" },
    cookie,
  );
  try {
    await waitForFile("admin-ready");
    expect((await request("/logout", "POST", {}, cookie)).status).toBe(200);
  } finally {
    await Bun.write(join(dir, "admin-release"), "");
  }
  expect((await pending).status).toBe(401);
  expect(
    (
      await request(
        "/login",
        "POST",
        { username: "admin-race", password: "original-password" },
        "",
      )
    ).status,
  ).toBe(200);
});
