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

The strategic, diplomacy, and deal adapters share the same seat context, canonical civilization identity, current strategic state, and model resolution. Strategic wakes receive a bounded recent diplomacy block from the durable pairwise transcript. Transcript rows are labeled as untrusted historical political data, and proposal, counter, acceptance, rejection, and enacted deal terms remain structured when available. Failed enrichment is logged and does not block the game turn.

The benchmark SocialRuntime is not automatically attached to an ordinary StrategistSession. Its public channels, autonomous AI-to-AI conversations, groups, and broader social episodes remain experimental standalone functionality. Ordinary Civ play currently exposes the existing pairwise diplomacy and deal path, not the full SocialRuntime feature set.

## Diagnostics

The logs and telemetry views identify the civilization player, game, unified mode, wake type, resolved model, outcome, and token totals where the provider reports them. Unified wake labels are `strategic`, `diplomacy`, and `deal`. Private transcript bodies are not added solely for diagnostics.

## Political memory

Unified seats also share one game-scoped SQLite political-memory store across strategic, diplomacy, and deal wakes. The model can sparsely record goals, commitments, subjective relationship assessments, uncertain beliefs, important episodes, and political projects through support tools. Records are scoped to the owning civilization, retain evidence references, and use retry-safe mutation IDs. The Civilization Minds inspector reads this state from the same `/api/session/minds` read model. Raw game facts and recent diplomacy remain separate authoritative evidence.
