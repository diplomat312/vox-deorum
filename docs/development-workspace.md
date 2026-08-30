# Local development workspace

The `upstream` remote points to the public Vox Deorum repository. The branch
`codex/source-recovered` tracks the source-based upstream checkout and is the
branch to use for implementation work. The earlier compiled installation
snapshot is preserved on branch `codex/vox-deorum-development` and tag
`local-runtime-baseline` for forensic comparison.

The installed build had no TypeScript source, but the upstream checkout restores
the editable `vox-agents/src`, `mcp-server/src`, and `bridge-service/src` trees.
Group-chat work is represented in source across the web chat, diplomacy
transcript, and MCP transcript tools; use the interactive-diplomacy plans under
`docs/plans/` as the design record.

Keep local runtime snapshots, credentials, logs, telemetry, and binaries out of
Git. Commit focused changes on `codex/*` branches, run the relevant package
tests, and merge or rebase from `upstream/main` before handing off work.
