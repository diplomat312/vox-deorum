# Testing

Vox Deorum's three TypeScript services are tested with **[Vitest](https://vitest.dev)** — every one of them, never Jest.

The guiding idea: a test should exercise a component **the way the real stack uses it**. That means going through the MCP client, through the bridge's HTTP API, through both transports — not reaching past the seams to call internals directly.

The DLL and the mod, being C++ and in-game Lua, are verified by running the game rather than by a unit harness. This page covers the Node.js side, where the automated suites live. For how to build and run the stack the tests sometimes drive, see [setup.md](setup.md).

## Running the tests

From the repo root, `npm run test:all` runs every workspace's suite. Each service also has its own scripts; the common ones are the same everywhere:

| Command | What it does |
|---|---|
| `npm test` | Run the suite once. |
| `npm run test:watch` | Re-run on change. |
| `npm run test:coverage` | Run with a coverage report. |

The interesting differences are in *what each service's default run includes*, because each has tests that need real external things.

### Bridge service — mock vs. real DLL

The bridge talks to a named pipe, so its tests can run against either a **mock DLL server** that implements the full IPC protocol or the **real** game. The `USE_MOCK` environment variable chooses the mode:

- `npm test` (`USE_MOCK=true`, the default) runs with mocks, so the suite is fast and needs no game.
- `npm run test:real` (`USE_MOCK=false`) targets `tests/real/**` against a live Civilization V DLL. It is live-only and is not CI-able by design.

The mock implements the whole protocol — registering Lua functions dynamically, simulating game events, with adjustable response delays — so integration paths are covered without a running game.

### MCP server — both transports

The MCP server supports stdio and HTTP transports, and the rule is that tests must pass on **both**. The `TEST_TRANSPORT` environment variable selects which (HTTP is the default; `npm run test:stdio` forces stdio).

The default `npm test` and `npm run test:mock` run the in-process mock tier. Real-tier tool tests use an MCP client rather than invoking tool methods directly, so they validate input handling, errors, and output exactly as an agent would experience them.

`npm run test:real` is wired to `tests/real/**` and boots the real MCP Server against the real Bridge Service in mock-DLL mode through `tests/real.setup.ts`. The stack is intended to be CI-able without Civilization V, but the existing real-tier integration tests were written for a live game and still need adaptation before the tier passes reliably.

### Vox agents test tiers

The agent framework separates its cheap default tests from future real-stack and live-environment tiers:

| Pathway | Command | Notes |
|---|---|---|
| **Mock** | `npm test` or `npm run test:mock` | The default in-process mock tier in `tests/mock/**`. Telepathist coverage lives under `tests/mock/telepathist` and can skip when recorded telemetry is unavailable. |
| **Real** | `npm run test:real` | Reserved for a future out-of-process real MCP Server and mock Bridge bottom in `tests/real/**`. It currently passes with no tests. |
| **Game** | `npm run test:game` | The live Civilization V tier in `tests/live/game/**`. It needs Windows and Civ V, runs sequentially with long timeouts, and is excluded from the default suite. |
| **OBS** | `npm run test:obs` | The live OBS tier in `tests/live/obs/**`. It needs OBS Studio with its WebSocket server and is excluded from the default suite. |

The package scripts are `npm test`, `test:mock`, `test:watch`, `test:real`, `test:game`, `test:obs`, `test:coverage`, and `test:ui`.

Because the game and OBS suites are environment-heavy and slow, the convention is firm: **don't touch the OBS tests unless you're changing OBS code, and don't touch the game tests unless you're changing the game-launch/process code.**

## Conventions for writing tests

These hold across all three services:

- Test files live in each service's `tests/` directory with a `.test.ts` extension, and **mirror the source structure** so a module and its test are easy to pair.
- Global setup lives in `tests/setup.ts` — the mock server, the MCP client, or whatever the suite shares.
- Use nested `describe` blocks and the `"should …"` naming convention for test names.
- Test through the public seam — the MCP client, the HTTP endpoint, the mock DLL — rather than calling internals. This survives refactors and catches the bugs an agent would actually hit.
- Production code uses the Winston logger only; `console.log/error/warn` is acceptable **in tests** but never in shipped code.

Each component's `AGENTS.md` carries the binding, directory-specific rules. Read it before writing tests in that workspace.

## What isn't unit-tested

The C++ DLL and the in-game Lua mod aren't covered by these suites.

- The **DLL** is verified by building it (CI compiles it under both MSVC and clang — see [setup.md](setup.md)) and by running the game with the debug build attached. The connection service is exercised end to end whenever the stack runs against a real game.
- The **mod** is validated in-game: enabling it, generating a world, and confirming the events and UI hooks fire.

The mock-DLL path in the bridge tests is what lets the Node.js side cover the IPC contract without all of that.
