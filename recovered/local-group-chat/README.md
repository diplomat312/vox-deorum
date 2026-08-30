# Recovered local group-chat work

These files were recovered from the installed Vox Deorum 0.12.1 runtime at
`C:\\Users\\bikka\\AppData\\Local\\Programs\\Vox Deorum` after discovering
that the local DeepSeek-era group-chat changes had been compiled into `dist`
but were absent from the TypeScript source checkout and Git history.

They are preserved as compiled JavaScript evidence, not claimed to be the
original TypeScript source. The implementation adds:

- `broadcast-message` and `get-global-messages` for a durable world channel;
- `worldChat` pacing interruption on letters and broadcasts;
- a `world-beat` scheduler for unprompted AI diplomacy;
- AI-to-AI correspondence over deterministic diplomacy threads;
- explicit `[WORLD]` promotion from private correspondence to the public feed;
- automatic reopening and deduplication after service restarts.

The canonical editable source is still the upstream TypeScript tree. This
directory is a forensic reference for porting the local behavior into source,
with tests, in a future commit.
