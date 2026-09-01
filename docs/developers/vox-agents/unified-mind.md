# Unified civilization mind

Vox Deorum supports an additive `unified-mind` mode for AI seats. A unified seat keeps the existing `VoxPlayer`, `VoxContext`, strategic executor, diplomacy executor, transcript store, and MCP tools. Its strategic and diplomacy wakes are thin adapters around one civilization-level identity and one model assignment.

## Configuration

Set `mind` to `unified-mind` and assign the model under the same seat's `llms.unified-mind` key. The legacy `strategist` field remains required for backward-compatible config parsing, but it is not used to select the strategic wake for a unified seat. The diplomacy voice is selected automatically.

The ready-to-copy mixed-model example is [configs/unified-mind-mixed-4p.json](../../../configs/unified-mind-mixed-4p.json). It gives four AI seats independent model choices and a human seat.

```json
{
  "strategist": "simple-strategist",
  "mind": "unified-mind",
  "llms": {
    "unified-mind": "openrouter/minimax/minimax-m3:free"
  }
}
```

Start it from the repository root with `npm run strategist -- -c unified-mind-mixed-4p.json` from `vox-agents/`, or use the session UI to load the saved configuration and choose Start. The active assignment response reports `mind: "unified-mind"` and the shared `mindModel`.

## Continuity and fallback

Both wakes use the same civilization identity and seat context. Strategic prompts receive a bounded recent diplomacy section assembled from the durable transcript store. Social prompts continue to receive the current strategic/game context through the existing live-envoy path. Failed transcript enrichment is best effort and does not block a turn.

Legacy strategist and diplomat agents remain available for existing configurations. Unified mode does not remove or rewrite those compatibility paths.
