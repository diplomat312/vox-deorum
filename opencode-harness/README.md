# opencode-harness

The harness that lets OpenCode model sessions pilot a Civilization V seat. It replays a recorded game, feeds each seat the observation it would have seen, runs the seat's turn and records the reasoning, calls and usage that came back. OpenCode owns the session; Vox Deorum owns the world.

## Recorded corpus

The fixtures under `corpus/` come from a recorded four seat game. Regenerate them from the repository root:

```
node opencode-harness/scripts/harvest-corpus.mjs
```

The harvester reads the source recording through `git show`, so the working tree is left alone and the output is deterministic. From inside the package, `npm run harvest` does the same thing.

## Tests

```
npm test          # in this package
npm run test:all  # from the repository root
```

Tests live in `tests/mock` and run entirely in process. They never launch Civilization V and never touch the network.

## Plan

The stage order and the requirements behind this package live in [docs/plans/opencode-harness/](../docs/plans/opencode-harness/).

See [AGENTS.md](AGENTS.md) for the component conventions.
