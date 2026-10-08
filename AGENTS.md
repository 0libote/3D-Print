# AGENTS.md

## Bun-first workflow

This project uses Bun as the runtime, package manager, test runner, server runtime, SQLite provider, and container runtime.

- Use `bun install`, `bun add`, `bun remove`, and `bunx --bun` instead of npm/npx equivalents.
- Run TypeScript directly with Bun. Do not add `tsx` or `ts-node`.
- Prefer `bun:test` for tests, `Bun.serve()` for server work, `bun:sqlite` for SQLite, `Bun.file()` / `Bun.write()` for suitable file I/O, `Bun.password` for password hashing, and Bun crypto APIs where they simplify code.
- Before adding a dependency, check whether Bun or a standard Web API already provides the capability.
- Keep Vite and StyleX for the frontend build because the project relies on their plugin pipeline. Do not replace them with `Bun.build()` unless that pipeline is proven equivalent.
- Do not mechanically remove `node:` imports. Bun implements Node compatibility APIs, and filesystem/path primitives are appropriate when Bun has no clearer native equivalent.
- Keep the Bun version aligned across `packageManager` and the Docker image.
