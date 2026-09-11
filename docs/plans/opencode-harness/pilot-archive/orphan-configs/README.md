# Configurations from the pre-recovery snapshot

These eight files were the only content of value on `codex/vox-deorum-development`, an
orphan branch built from the installed package before this repository's source was
recovered. That branch has since been deleted, because its one functional change is
byte-identical to what is in the tree: the fourteen Lua files under its `runtime/mcp-server`
match ours exactly, and its `configs/observer-8p-7llm.json` is unmodified.

What it had and nothing else did: the seat configuration profiles the operator was actually
running, plus the environment template. They are kept here because a working set of seat
profiles is a useful starting point for a live game, not because anything depends on them.

- `config.json` and the `observer-*.json` profiles: an observer game, seven model seats and
  one watched seat, on deepseek-v4-flash, with a resume-safe variant.
- `opencode-go-deepseek-v4-flash.json`: the same idea pointed at the OpenCode provider.
- `human-small-3-deepseek.json`: a smaller three-seat table with a person in it.
- `.env.example`: the environment template. The key is blank.

