# Stage 7.04: Wire live chat, deals, and notifications

> Part of the stage-7 sub-plan ([specification](specs.md); [stage index](../07-ingame-panel.md)). Stages 7.01 and 7.02 delivered the panel and deal editor behind mock drivers. Stage 7.03 delivered the event transport, push functions, transcript paging, and bridge queues. This stage replaces the probes and mocks with the existing Web chat engine and real deal actions.

## Objective

Make the in-game diplomacy panel a second client of the Web conversation backend.

The player can open a shared transcript, send a message, watch the counterpart's assigned diplomat stream a reply, negotiate and enact deals, and resume the conversation through native notifications. The normal player, human strategist, and pure observer paths use the same bridge and thread factory. Their only differences are the effective seat carried by the event and observer presentation.

The implementation is complete when:

- both clients use the same deterministic diplomacy thread and durable transcript;
- `runChatTurn` owns every human message, proposal, and counter;
- accept, reject, and retract use shared backend actions;
- the panel receives authoritative transcript rows, not a second deal-state protocol;
- accepted deals still enact only through `enact-agent-deal`;
- promise terms that are already illegal are refused before a proposal is stored;
- a pure observer can open VP's native deal presentation, while native item legality and backend enactment continue to reject unsupported participants;
- successful replies and deal outcomes produce native notifications, including across turn boundaries.

## Starting point and constraints

The stage-03 bridge in `vox-agents/src/envoy/ingame-bridge.ts` already owns two independent per-pair queues:

- the action FIFO serializes mutating chat and deal events;
- the push FIFO orders Lua calls and atomic transcript reflushes without waiting for the action FIFO.

`DiplomacyChatMessage` still uses the temporary `appendProbe`, and `DiplomacyDealAction` still reports that deal actions are not wired. `civ5-mod/UI/VoxDeorumDiploTransport.lua` still contains probe listeners, and both UI contexts still finish with mock-driver includes.

The Web implementation already provides the reusable engine:

- `runChatTurn` in `vox-agents/src/web/chat/turn.ts`;
- `openDiplomacyChat` in `vox-agents/src/web/chat/factory.ts`;
- the thread lock in `utils/diplomacy/chat-turn-commit.ts`;
- proposal, rejection, and enactment helpers in `utils/diplomacy/deal.ts`;
- durable transcript utilities in `utils/diplomacy/transcript.ts`.

This stage may extend those interfaces, but it must not create a game-only chat engine or duplicate route logic.

## Technical decisions

1. **`runChatTurn` reports the durable rows it creates.** Streaming deltas are temporary presentation. `beginChatTurn` returns the committed caller row. Once it owns the thread lock, `runChatTurn` observes later confirmed writes for that thread until terminal cleanup. This covers the caller row, final diplomat reply, deal-tool rows, and a possible `close` row without a second transcript read. The transcript remains authoritative, and the panel still deduplicates by transcript ID.

2. **Proposal state belongs to the durable backend.** The panel, Lua driver, bridge, and Express route do not decide whether a rejection is redundant or stale. A transactional mcp-server action checks the stored proposal and writes the rejection atomically. Repeating the same rejection returns the existing row without appending another, while rejecting an accepted, countered, or superseded proposal is a conflict.

3. **VP's observer deal presentation remains available.** VP can bind an observer slot as `g_iUs` and show the native trade screen. Vox Deorum removes its stricter presentation-only major-civilization checks. This does not make observer deal items legal: `CvDeal::IsPossibleToTradeItem`, `inspect-deal`, proposal validation, and enactment retain their existing participant limits.

4. **One game action may be pending per pair.** No request token is added. The bridge pushes the committed row associated with the action, and the transport driver resolves the mounted deal editor only when that row matches the pending action. Re-pushing an existing row for an idempotent rejection is valid: the panel deduplicates it, while the deal-screen resolver still receives the acknowledgement.

5. **Notifications report newly committed successful outcomes only.** Reaching `done` is necessary but not sufficient. A turn posts only when its terminal rows contain a new counterpart reply, close, or state-changing deal outcome. A state-changing accept, reject, or retract also posts. An idempotent acknowledgement, validation conflict, transport failure, or pre-commit rejection does not post another one.

## Work items

### 1. Create a shared deal-action boundary

Refactor `vox-agents/src/web/chat/deal.ts` so Express routes contain only HTTP lookup, request parsing, and response mapping.

First, make the error vocabulary consistent:

- Change `requireCurrentOpenProposal` to throw `ProposalConflictError` for a missing, closed, superseded, malformed, or self-authored proposal instead of throwing bare `Error`. The self-authored case guards accept only. The reject path permits the proposal author to reject their own offer, which is a retraction under the store's existing rule that either endpoint may speak `deal-reject`.
- Add a shared live-turn and closed-this-turn guard used by `runChatTurn`, accept, and reject. It must preserve the stricter `runChatTurn` behavior: a live thread without a current turn is unavailable, not turn zero or the thread's cached metadata turn.
- Give the missing-live-turn and closed-this-turn cases distinct typed errors so both transports can map them without inspecting message text.
- Keep the shared thread-busy message in one constant.

Then add transport-neutral actions:

- `acceptDealAction(thread, proposalMessageID)`;
- `rejectDealAction(thread, proposalMessageID, content?)`.

Each action:

1. checks that the thread is a live diplomacy thread;
2. applies the shared live-turn and closed-this-turn guard;
3. derives the acting endpoint with `audienceID(thread)`;
4. runs under `withThreadLock`;
5. calls the authoritative deal helper;
6. hydrates the returned durable rows directly into the live cache;
7. returns `{ rows, changed }`, where `rows` carries the durable result and `changed` distinguishes a new state transition from an idempotent acknowledgement.

Keep thread lookup transport-specific. Express continues to resolve `chatId`; the in-game bridge passes an already opened `EnvoyThread`.

Add a transactional `reject-agent-deal` action in mcp-server and make `appendDealReject` call it. This keeps proposal-state authority beside `enact-agent-deal`. Its input includes the expected pair, proposal ID, speaker, and content. The transaction verifies that the proposal belongs to that pair and that the speaker is one endpoint, then uses the proposal's stored roles for the result row.

Within the same transaction:

- if the referenced proposal is the active open offer, append `deal-reject`;
- if that proposal already has a rejection by the same speaker, return the existing row with `AlreadyRejected: true` and do not write;
- if a different proposal is active, another speaker already rejected it, or the proposal is accepted, enacted, or superseded, return a structured conflict;
- never append more than one terminal rejection row for a proposal.

Return a discriminated result for `rejected`, `already-rejected`, or `conflict`, including the exact rejection row for either successful outcome. Infrastructure failures still use the MCP error channel. `appendDealReject` translates the structured conflict to `ProposalConflictError` without parsing error text.

Register the new tool in `mcp-server/src/tools/index.ts` and document it in `mcp-server/docs/tools.md`. Make `append-message` refuse `deal-reject`, just as it already refuses `deal-accept` and `deal-enacted`, so no caller can bypass the transactional action.

Give `enact-agent-deal` the same machine-readable conflict boundary. A proposal that becomes stale, closes, is answered, or has the wrong recipient after the vox-agents precheck returns a structured conflict; `enactAgentDeal` maps it to `ProposalConflictError`. Validation or infrastructure failures remain MCP errors. Retain the tool's current success and idempotency fields so existing callers do not lose enactment details.

The Web mapper preserves its public status classes:

| Error | HTTP |
|---|---:|
| invalid request or `IllegalDealError` | 400 |
| busy, closed this turn, or proposal conflict | 409 |
| live turn unavailable | 503 |
| store, bridge, inspection, or enactment failure | 502 |

Delete accept's catch-time second call to `requireCurrentOpenProposal`. Typed results from the two backend transactions now distinguish proposal conflicts from infrastructure failures without a race-prone re-probe. Replace `mirrorDealRowsBestEffort` with a small direct hydrator for returned rows, and remove the full deal-transcript reread if it has no remaining caller.

Update the existing Web route tests, shared action tests, and mcp-server action tests to cover typed errors, transactional idempotent rejection, stale rejection, the accept race after precheck, and self-authored retraction. The Web UI behavior remains unchanged except that a repeated reject no longer creates a redundant row.

### 2. Make `runChatTurn` report every durable row

Add a small per-thread transcript-row observer in vox-agents. After `beginChatTurn` returns with the lock held, `runChatTurn` registers the observer, runs the model and completion path, then unregisters it before `turn.finish` releases the lock. Every relevant writer receives the active `EnvoyThread`, so it can report a row after the backing store confirms that the current operation created it. Reporting is a no-op when no turn observes that thread.

The observer accepts rows only for its thread, deduplicates by transcript ID, and returns them in ID order. It needs no `AsyncLocalStorage`, transcript cursor, follow-up query, or transport argument threaded through negotiator tools.

Make every relevant write-through helper return and record an exact `TranscriptPushMessage` projection:

- `beginChatTurn` exposes the committed caller row for ordinary text, proposal, and counter requests, and uses that row's ID and turn in the live cache. A triple-brace trigger has no durable caller row.
- `ChatTurn.complete` returns and records the archived diplomat reply row when there is one, and uses that exact row when normalizing the cached reply.
- `appendDealProposal` continues to return its exact proposal or counter row and also records it.
- `appendDealReject` returns the exact new or existing rejection row and records it only when the current call created it.
- `appendCloseMessage` returns its close row as well as the stamped turn. `closeConversation` returns the ordered rejection and close rows it created.
- `enact-agent-deal` adds full `deal-accept` and `deal-enacted` row projections while retaining its current ID and status fields. Its idempotent path returns the existing enacted row. Pass the active thread into `enactAgentDeal` from the shared action and negotiator so it can record only rows created by the current call for the captured thread.

Add one transport-neutral row contract to the sink:

- `connected.rows` contains the durable caller row committed before the model run;
- `done.rows` contains rows committed after `connected`, including terminal tool rows and the final archived reply;
- `error.rows` contains any rows committed after `connected` but before a post-commit failure.

Keep `connected.deal` and `done.deals` as compatibility views for the Web client, derived from the same captured full deal rows. The Web SSE adapter sends its existing public payload and omits the new internal `rows` fields. The in-game sink consumes `rows` directly. No Web client migration or public event change is required. Do not reread deal messages at the end of the turn.

The phase boundary is explicit. `connected.rows` comes only from `turn.callerRow`; the later observer never records that ID. Before either terminal event, `runChatTurn` freezes and unregisters the observer, snapshots its rows once, and uses that terminal-only set for `done.rows`, `error.rows`, `done.deals`, and cache repair. No ID may appear in both phases, and detached work cannot add rows after the terminal snapshot.

Every committed turn emits exactly one terminal sink event: either `done` or `error`.

`runChatTurn` updates `thread.messages` from the observed rows before either terminal event. On success, it inserts deal rows at the existing reply boundary before the normalized reply. On failure, `ChatTurn.finish` first removes transient model output, then the turn restores every observed row that belongs in the live cache, including deal rows and any successfully archived reply. This preserves cache ordering without the `knownDealIDs` scan or a `readDealMessages` reread.

Stop treating final reply archival as best-effort. If the store refuses that append, `ChatTurn.complete` throws, `runChatTurn` emits `error` with any rows already committed after `connected`, and no `done` event is sent. A streamed draft therefore cannot be mistaken for a durable completed reply.

Add focused tests for:

- caller text, proposal, and counter rows in `connected.rows`;
- final reply, proposal, rejection, enactment, and close rows in `done.rows`;
- nested negotiator writes remaining inside the correct turn capture;
- ID ordering and duplicate suppression;
- no transcript ID appearing in both `connected.rows` and a terminal row list;
- rows committed before a post-commit failure appearing in `error.rows`;
- durable rows surviving failed-turn cache cleanup;
- final reply archival failure producing `error`, not `done`;
- the unchanged public Web SSE payload derived from the new internal row contract.

### 3. Make thread reopening safe during a live turn

Move the reopen-while-busy guard into `openDiplomacyChat`.

When the deterministic pair thread already exists and `isThreadBusy(thread.id)` is true, return it without changing:

- participant metadata;
- agent or context assignment;
- title or timestamps;
- `thread.messages`;
- compaction state.

This protects both clients. A Web reopen can no longer compact and replace `thread.messages` after `beginChatTurn` captured its reply index. The in-game bridge also gets the existing thread so `Begin.busy` and `ThreadBusyError` describe the same live state.

Add a factory test that opens a thread during an in-flight turn and proves that no dependency mutation or compaction occurs.

### 4. Reject dead-on-arrival promises before archival

`appendDealProposal` already rejects illegal ordinary trade items after a fresh `inspect-deal`, but promises currently receive only advisory agreeability factors. A schema-valid promise can therefore become the active durable offer even when enactment would reject it immediately.

Close the gap at the shared proposal chokepoint:

1. Widen `InspectedPromiseSchema` in `mcp-server/src/tools/knowledge/inspect-deal.ts` with `legality` and `reasons`, matching the existing inspected-item vocabulary. Keep `agreeabilityFactors` unchanged and advisory.
2. Pass proposed promises into the read-only `inspect-deal.lua` invocation.
3. In `mcp-server/lua/inspect-deal.lua`, extract enact mode's promise checks into one read-only validator used by both inspection and enactment. It covers:
   - two distinct live endpoints and correct pair direction;
   - duplicate logical commitments;
   - a valid third-party Coop War target;
   - both-direction Coop War eligibility;
   - an already-preparing Coop War;
   - existing `MILITARY`, `EXPANSION`, and `BORDER` promises.
4. Return one legality result per input promise, aligned by index.
5. Extend `appendDealProposal`'s existing `IllegalDealError` guard to include illegal promises and their per-term reasons. Broaden its structured detail type from trade items to deal terms so negotiator feedback does not parse display strings.

`NO_DIGGING` remains always legal at inspection because the game exposes no made-state query and reapplying it at enactment is harmless. Enactment still repeats every check against current game state. Proposal-time inspection prevents only offers that are already impossible.

Add mcp-server and vox-agents tests for each promise rule, including Web-authored and negotiator-authored proposals. Verify that an illegal promise writes no proposal row.

### 5. Replace the chat probe with `runChatTurn`

Widen the bridge's internal event parser so it retains the full canonical deal-action shape as well as chat text:

- `Action`;
- `Deal`;
- `ProposalMessageID`;
- `Text`.

For `DiplomacyChatMessage`, keep the existing admission rule: valid event shape, different player and counterpart IDs, and a live counterpart context. Do not add seat attestation or flavor-specific capability logic.

On the action FIFO:

1. Open the pair with `openDiplomacyChat`, always passing the event `PlayerID` as `callerPlayerID`.
2. Pass `callerRole: "Observer"` and no caller identity only when `AsObserver` is true.
3. Call `runChatTurn({ kind: "text", chatId: thread.id, message: event.Text }, gameSink)`.
4. Let the game sink push `connected.rows`, streaming deltas, and the terminal `done.rows` or `error.rows`.
5. Await the push work queued by the sink.
6. Post the successful-outcome notification from item 7 only when the sink reached `done` and its terminal rows contain an eligible newly committed outcome.

Delete `appendProbe`. `runChatTurn` commits the caller row itself, so a pre-append would duplicate the message.

A pre-stream `ChatTurnRejection` becomes `Status{error}`. A post-commit failure comes through `sink.error`, including any durable rows written before the failure. The streamed draft remains temporary and is replaced only when the durable final reply arrives in `done.rows`.

### 6. Add the game stream sink and real deal handler

Implement a `ChatStreamSink` adapter inside `vox-agents/src/envoy/ingame-bridge.ts`.

#### Stream mapping

The sink uses an explicit chunk allowlist:

- `text-delta` with `id === "progress"` becomes a generic composing or tool status, never spoken text;
- ordinary `text-delta` chunks append to one accumulated spoken reply;
- about once per second, convert the accumulated reply with `markdownToCiv5` and enqueue `VoxDeorumDiploDelta`;
- recognized reasoning and non-message tool chunks become generic `reasoning` or `tool` states without their content;
- an unknown chunk is dropped, or produces at most one generic status;
- `onDisconnect` is a no-op because there is no browser socket to cancel the game run.

Sink callbacks never await the action FIFO. They only append work to the independent push FIFO.

Push every row from `connected.rows`, `done.rows`, and `error.rows` through the existing `Messages{append}` path. The game sink also retains those rows as the outcome of the current action for pending-action resolution and notification text. At completion, snapshot and await the current per-pair push tail. Extend the queue helper so this tail can be observed without awaiting it from inside one of its own workers.

#### Deal actions

Before dispatching any `DiplomacyDealAction`, resolve the caller and call `openDiplomacyChat` with the same caller, observer, context, and counterpart fields as the chat path. `DiplomacyPanelOpened` is read-only and deliberately does not populate the thread cache, so a deal action must not assume that an `EnvoyThread` already exists.

Handle `DiplomacyDealAction` on the action FIFO:

- **Propose:** call `runChatTurn({ kind: "deal", chatId, deal }, gameSink)`.
- **Counter:** call `runChatTurn({ kind: "deal", chatId, deal, expectedProposalID: ProposalMessageID }, gameSink)`.
- **Accept:** call `acceptDealAction(thread, ProposalMessageID)`.
- **Reject or retract:** call `rejectDealAction(thread, ProposalMessageID, Text)`. The game event uses canonical `reject`; retract remains a local driver intent.

Propose and Counter receive their rows from the `runChatTurn` sink. Accept queues the exact rows returned by `acceptDealAction`; Reject and Retract queue the exact row returned by `rejectDealAction`. Direct actions use `changed` for notification eligibility, while an idempotent rejection still re-pushes its existing row to acknowledge the pending editor. There is no post-action transcript query. Typed failures use one bridge mapper and become `Status{error}`.

The game-side pending resolver uses durable rows:

- proposal and counter resolve from the exact caller row in `connected.rows`;
- accept resolves when the matching `deal-accept` and `deal-enacted` result rows arrive;
- reject and retract resolve from the matching `deal-reject`, including an existing row returned by the action's idempotent path;
- an error raises `LuaEvents.VoxDeorumDealActionResolved({ success = false, reason = ... })`.

The panel keeps the proposal card pending, and the deal screen keeps its mounted editor, until this resolution. On error, the existing screen resolver restores the same terms, promises, and public message.

### 7. Post native notifications for successful outcomes

Add one notification helper in vox-agents that:

- accepts the caller, counterpart, and durable outcome rows;
- returns without posting unless those rows contain a newly created counterpart `text` or `close` row, or a state-changing deal row;
- uses the counterpart leader name as `Summary`;
- selects the first non-empty line of the final counterpart reply or deal outcome as `Message`;
- converts both fields through `markdownToPlain`;
- strips the pipe delimiter and trims to the tool's schema limits;
- calls `post-notification` with `PlayerID` and `CounterpartID`.

Call it after:

- a successfully completed text or deal turn;
- a successful accept;
- a newly written reject or retract.

Do not call it for an idempotent rejection acknowledgement, validation error, conflict, unavailable turn, or transport failure. Treat notification delivery as best-effort after the conversation action succeeds: log a posting failure, but do not turn an already committed action into `Status{error}`.

Observer notification delivery requires two mcp-server changes:

1. Add a shared `MaxPlayers` bound beside `MaxMajorCivs`, and widen `post-notification`'s `PlayerID` to the full game-player range. `CounterpartID` remains a major civilization.
2. In `mcp-server/lua/post-notification.lua`, redirect a notification addressed to a pinned seat to `Game.GetActivePlayer()` when the active player is an observer whose UI override equals that requested seat. A pure observer keeps its real observer slot, and normal play remains unchanged.

The bridge always posts after a successful outcome. In `VoxDeorumDiploPanel.lua`, if a notification for the currently open pair is added, remove it immediately. Opening or clicking a conversation continues to dismiss all previously tracked notifications for that pair.

### 8. Replace the Lua mocks with transport drivers

Grow `civ5-mod/UI/VoxDeorumDiploTransport.lua` from the stage-03 probe into the real panel driver:

- remove the `Lua.log` probe listeners;
- keep lazy `Game.RegisterFunction` registration;
- implement `onOpen`, `onSend`, `onLoadEarlier`, retry, and push-event handlers;
- compute the effective seat once per outbound event with `VoxDeorumSeat`;
- include `AsObserver = true` only for a pure observer;
- emit `DiplomacyPanelOpened`, `DiplomacyChatMessage`, and `DiplomacyTranscriptRequest`;
- translate `Begin`, `Messages`, `Status`, and `Delta` into the existing `VoxDeorumDiploUI` methods;
- retain the panel's transport acknowledgement and reply-silence timeout tiers.

Keep the existing `VoxDeorumDiploTransport` include and remove the following `VoxDeorumDiploPanelMock` include.

Create `civ5-mod/UI/VoxDeorumDealTransport.lua` as the real `VoxDeorumDealUI.driver`, then include it from `VoxDeorumDealScreen.lua` in place of `VoxDeorumDealScreenMock`. The deal screen is a separate Lua context, so it cannot depend on the panel context's globals. It registers no DLL-callable functions. It subscribes to `LuaEvents.VoxDeorumDiploMessages` and `LuaEvents.VoxDeorumDiploStatus`, which the panel-owned transport emits.

The deal driver:

- Propose and Counter serialize the edited deal;
- Counter includes the mounted `proposalMessageID`;
- Accept, Reject, and Retract include the proposal ID;
- Retract maps deliberately to canonical `Action = "reject"`;
- Reset and Cancel remain local and emit no event;
- the event's `PlayerID` is the effective seat;
- each item's and promise's human-side endpoint is that same effective seat;
- the mounted screen stays pending until `VoxDeorumDealActionResolved`.

Track the pending pair, action, and proposal ID in the deal context. Match incoming durable rows to that state before raising `VoxDeorumDealActionResolved`. Once both real drivers are active, delete the two mock-driver files. Update `VoxDeorum.modinfo` to import the new transport file, remove the mock entries, and let `deploy.bat` refresh changed file hashes.

#### Preserve VP observer presentation

Remove Vox Deorum's presentation-only major-civilization admission checks:

- `VoxDeorumDealScreen.open` and `mount` accept the real effective seat when it is an addressable Civ player slot with `Players` and `Teams` entries, even when it is an observer;
- `VoxDeorumOpenDeal` and `VoxDeorumResumeHumanToHumanEditor` accept distinct player slots below `MAX_CIV_PLAYERS`, matching VP's native `OnOpenPlayerDealScreen`;
- keep the counterpart requirement as a living major civilization;
- bind the observer slot directly as `g_iUs`; do not substitute a major seat and do not override `Game.GetActivePlayer()`.

Keep native legality checks where they belong. Promise choice checks, ordinary item construction, `inspect-deal`, proposal archival, and enactment may report that an observer participant is unsupported. Those failures must restore the mounted editor and must not produce a partial transcript or game write.

Remove the final `VoxDeorumDealScreenMock` include once the real driver is active.

### 9. Align the parent stage documents

Update `specs.md` with the implementation contracts settled here:

- `runChatTurn` reports all rows created during a turn and no longer performs a deal-only terminal reread;
- VP permits observer-slot deal presentation, while Vox Deorum currently adds the stricter presentation gate that this stage removes;
- `reject-agent-deal` owns rejection rows and is the explicit backend-managed idempotency exception to the earlier no-new-idempotency note.

Update the writer-split description so `append-message` no longer owns `deal-reject`. Keep the public Web event contract and capability matrix unchanged. The stage index already describes the intended player-facing outcome.

## Verification

### Automated checks

Run the repository build and test commands from the root:

- `npm run build:all`;
- `npm run test:all`.

After those pass, run `deploy.bat` from `civ5-mod/`. It owns the modinfo MD5 refresh and deploys the completed mod for the live checks.

The focused coverage must include:

- unchanged Web status classes for chat, accept, reject, and close;
- typed proposal, closed-turn, missing-turn, and busy failures;
- transactional idempotent rejection and stale rejection conflict in mcp-server;
- an accept proposal-state race remaining a typed conflict rather than becoming a 502;
- no accept catch-time re-probe;
- turn-scoped row capture across nested transcript writers;
- `connected.rows`, `done.rows`, and `error.rows` ordering, with no ID crossing phases;
- the unchanged public Web SSE payload;
- final reply archival failure producing an error without a false completion;
- exact accept and idempotent-reject rows returned without a transcript reread;
- reopening a busy thread without mutation or compaction;
- game-sink chunk allowlisting, progress-sentinel handling, delta throttling, and default drop;
- push-tail ordering for captured durable rows;
- every promise legality rule and no-write failures;
- notification targeting and pinned-observer redirect;
- notification-post failure remaining separate from action success;
- full parsing of `DiplomacyDealAction`;
- parent specification wording matching the row, observer-presentation, and rejection contracts.

### Live game checks

With Civ V, bridge-service, mcp-server, and an interactive vox-agents session running:

1. Open a pair that already has Web history. Confirm the full shared transcript renders and triple-brace control rows remain hidden.
2. Send a message. Confirm the sequence is sending, composing or tool status, streamed draft, then the exact durable final row. The Web view must show the same transcript IDs and raw markdown.
3. Leave during generation. Confirm a native notification arrives after the durable result, survives a turn boundary, and opens the correct pair.
4. Keep the panel open through a reply. Confirm the notification is posted and immediately removed for the open pair.
5. Reopen during generation. Confirm `Begin.busy`, ordered increments, and no cache resynchronization under the active turn.
6. Propose and counter from the native editor. Confirm the exact committed card arrives in `connected.rows`, the edited counter carries `expectedProposalID`, and Reset remains local.
7. Accept a proposal. Confirm `deal-accept` and `deal-enacted` arrive, game state changes, and a second accept is refused.
8. Reject and retract. Retry the same action once and confirm the action returns the existing outcome without appending a duplicate row. Attempt a stale rejection after a counter and confirm a clean conflict with the draft preserved.
9. Submit an already-made standing promise, an ineligible Coop War, and a malformed promise direction through both Web and game paths. Confirm each is rejected before a proposal row is stored.
10. Repeat as a human strategist. Confirm the pinned civilization's thread, diplomat, deal endpoints, enactment, notification redirect, and Web history all match normal play.
11. Repeat as a pure observer. Confirm VP's native deal presentation opens with the real observer slot as `g_iUs`. Unsupported item or enactment actions must fail cleanly with no partial transcript or game-state write.

## Out of scope

- live mirroring into an already open Web chat;
- a new deal-state push channel;
- forward transcript cursors or post-action transcript reconciliation;
- request tokens or stream generations;
- widening native deal-item legality to make observer slots valid major-civilization participants;
- changing the stage-8 direction configuration;
- changing the Declare War path delivered by stage 7.01.

## Done when

The in-game panel and Web are two clients of the same conversation system. They share the diplomat, thread, transcript, proposal validation, deal actions, and enactment path. Streaming remains responsive, final UI state comes from durable rows, notifications carry successful outcomes across turns, and every supported seat can open the same presentation without bypassing native authority.
