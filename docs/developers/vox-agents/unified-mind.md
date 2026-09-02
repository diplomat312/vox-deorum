# Unified civilization mind

Vox Deorum supports an additive `unified-mind` mode for AI seats. A unified seat keeps one political identity and one model assignment across strategic turns, spoken diplomacy, and binding deal decisions. The existing VoxPlayer, VoxContext, transcript, deal, pause, recovery, and MCP paths remain in use.

## Play Civ V against unified minds

Use [configs/unified-mind-play-5civ.json](../../../configs/unified-mind-play-5civ.json) for normal native Civ V play. Seat 0 is the native human seat and is intentionally absent from `llmPlayers`; seats 1 through 4 are separate unified civilization minds. The configured reference models are MiniMax M3 through OpenRouter, MiMo V2.5 through OpenCode, Muse Spark 1.2 Contributor through OpenCode Go, and MiniMax M3 again.

The dashboard Setup wizard presents this as a player-level choice: select Unified Civilization Mind to use one explicit civilization model for strategy, diplomacy, and deals, or select Legacy Agent Architecture to keep the older strategist configuration. The internal adapter names are not setup choices. The advanced configuration editor supports the same architecture switch for each configured seat and preserves unrelated model aliases when you edit it.

From the repository root, run:

`npm install`

`npm run strategist -- -c unified-mind-play-5civ.json`

The root launcher builds Vox Deorum, resolves the root `configs` directory, validates the configured model references, and then begins the normal Civ V launch. OpenRouter requires its configured API credential. OpenCode and OpenCode Go require the corresponding local provider access. Replace the per-seat `llms.unified-mind` values in the config if a different provider roster is configured.

AI seats consider the game every five turns and on important events in this example. Pairwise interactive diplomacy occurs through the existing in-game or Web diplomacy surface. Conversation, proposals, counters, acceptance, rejection, and deal terms use the same unified civilization identity and model for that seat.

## Human strategist/director mode

Use [configs/unified-mind-direct-5civ.json](../../../configs/unified-mind-direct-5civ.json) when the human should steer seat 4 through Vox Deorum's strategic influence panel. This is not normal native Civ V play. The human-strategist seat is an explicit director mode while all four AI seats still use unified minds.

## Configuration and continuity

Set `mind` to `unified-mind` on an AI seat and assign its model under that seat's `llms.unified-mind` key. The legacy `strategist` field remains required for backward-compatible parsing, but it does not select the strategic wake for a unified seat. Legacy strategist, diplomat, and negotiator configurations remain available for existing sessions.

The strategic, diplomacy, deal, and memory-maintenance adapters share the same seat context, canonical civilization identity, current strategic state, and model resolution. Strategic wakes receive a bounded recent diplomacy block from the durable pairwise transcript. Transcript rows are labeled as untrusted historical political data, and proposal, counter, acceptance, rejection, and enacted deal terms remain structured when available. Failed enrichment is logged and does not block the game turn.

The benchmark SocialRuntime is not automatically attached to an ordinary StrategistSession. Its public channels, autonomous AI-to-AI conversations, groups, and broader social episodes remain experimental standalone functionality. Ordinary Civ play currently exposes the existing pairwise diplomacy and deal path, not the full SocialRuntime feature set.

## Civilization continuity

Each unified civilization has one persistent plaintext Current Outlook, a factual append-only Recent Chronicle, and a same-mind Long-Term Chronicle for older history. The configured unified model is the only model that decides what political events mean, updates the Outlook, or compacts the Long-Term Chronicle. The backend records facts, keeps private entries scoped to entitled civilizations, bounds retrieval, and preserves raw evidence. It does not infer trust, promises, betrayal, importance, or relationship scores.

The `update-civilization-outlook` support tool rewrites the civilization's own concise Outlook when its political understanding materially changes. Diplomacy messages, deal lifecycle facts, successful strategy rationales, and visible game events are mechanically recorded without semantic classification. Outlook writes use optimistic revisions and chronicle entries use stable source keys, so retries do not silently overwrite or duplicate memory.

Memory maintenance is a bounded wake of the same configured civilization model. It is requested only when uncompacted Recent Chronicle history crosses the 24,000 estimated-token soft limit, and successful compaction targets about 16,000 tokens. The normal wake has a 32,000-token hard window, so diplomacy and deal activity remain bounded even when maintenance is unavailable. A failed maintenance wake leaves the prior long-term text and raw chronicle intact, so ordinary game cognition can continue. Maintenance is currently attempted before strategic wakes, rather than as a separate background scheduler. Internal revisions and sequence numbers are storage details and are not part of the model's political vocabulary.

## Diagnostics

The logs and telemetry views identify the civilization player, game, unified mode, wake type, resolved model, outcome, and token totals where the provider reports them. Unified wake labels are `strategic`, `diplomacy`, `deal`, and `memory`. Private transcript bodies are not added solely for diagnostics. The Civilization Minds inspector shows Current Outlook, Long-Term Chronicle, Recent Chronicle, maintenance state, and the ordinary cognition timeline.
