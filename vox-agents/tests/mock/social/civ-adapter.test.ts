import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryEnvironmentEventJournal, SocialStoreEnvironmentEventJournal } from '../../../src/social/environments/environment-event.js';
import { CivEnvironmentAdapter } from '../../../src/social/environments/civ/civ-environment-adapter.js';
import { bindCivActors, type CivSeat } from '../../../src/social/environments/civ/civ-actor-binding.js';
import { CivActionGateway, MemoryCivActionJournal, SocialStoreCivActionJournal } from '../../../src/social/environments/civ/civ-action-gateway.js';
import { CivEventBridge } from '../../../src/social/environments/civ/civ-event-bridge.js';
import { CivContextProvider } from '../../../src/social/environments/civ/civ-context-provider.js';
import { CivPlayerMind } from '../../../src/social/environments/civ/civ-player-mind.js';
import { refreshCivContactGraph } from '../../../src/social/environments/civ/civ-social-attachment.js';
import { registerExistingCivCapabilities } from '../../../src/social/environments/civ/civ-mcp-capabilities.js';
import type { CivMcpPort } from '../../../src/social/environments/civ/civ-mcp-port.js';
import type { GameEventNotification } from '../../../src/utils/models/mcp-client.js';
import { SocialStore } from '../../../src/social/store/social-store.js';
import { ActorLane } from '../../../src/social/runtime/actor-lane.js';
import { createSupportReadOperationId } from '../../../src/social/runtime/social-scheduler.js';
import { createSocialReferenceSet, SocialContextBuilder } from '../../../src/social/context/social-context-builder.js';
import type { SocialActor } from '../../../src/social/types.js';
import { getKnownMajorPlayerIds, type StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import type { VoxPlayer } from '../../../src/strategist/vox-player.js';

const actors: SocialActor[] = [
  { id: 'human-seat', ordinal: 0, control: 'human', displayName: 'Rome', sessionId: 'session', createdAt: 'now', status: 'active' },
  { id: 'llm-seat', ordinal: 1, control: 'model', displayName: 'Rome', sessionId: 'session', createdAt: 'now', status: 'active' },
];
const seats: CivSeat[] = [
  { playerId: 3, civilizationType: 'CIVILIZATION_ROME', civilizationName: 'Rome', leaderName: 'Augustus', human: true },
  { playerId: 7, civilizationType: 'CIVILIZATION_ROME_2', civilizationName: 'Rome', leaderName: 'Caesar' },
  { playerId: 9, civilizationType: 'CIVILIZATION_EGYPT', civilizationName: 'Egypt', nativeVpOnly: true },
];

describe('Civ Pass 3 adapter seams', () => {
  it('should bind arbitrary seats without using player zero or display names', () => {
    const bindings = bindCivActors('session', 'game-1', actors, seats, { 'human-seat': 3, 'llm-seat': 7 });
    expect(bindings.map((binding) => binding.playerId)).toEqual([3, 7]);
    expect(seats.find((seat) => seat.nativeVpOnly)?.playerId).toBe(9);
    expect(bindings[0]?.actorId).not.toBe(bindings[1]?.actorId);
  });

  it('should deduplicate environment events and refuse stale game events', async () => {
    const onEvent = vi.fn(async () => undefined);
    const adapter = new CivEnvironmentAdapter(new MemoryEnvironmentEventJournal(), onEvent);
    await adapter.attach('session', { environment: 'civ5', gameId: 'game-1', turn: 4, facts: {}, seats, normalizedState: { era: 'Classical' } }, actors, { 'human-seat': 3, 'llm-seat': 7 });
    const event = { gameId: 'game-1', turn: 4, type: 'city-lost', sourceKey: 'game-1:4:city-lost:3', actorId: 'human-seat', payload: { city: 'Rome' } };
    await expect(adapter.ingest(event)).resolves.toBe(true);
    await expect(adapter.ingest(event)).resolves.toBe(false);
    expect(onEvent).toHaveBeenCalledTimes(1);
    await expect(adapter.ingest({ ...event, gameId: 'old-game', sourceKey: 'old-game:4:city-lost:3' })).rejects.toThrow(/game ID/);
  });

  it('should apply the authoritative contact graph to references and event routing', async () => {
    const adapter = new CivEnvironmentAdapter(new MemoryEnvironmentEventJournal());
    const contactSeats = seats.slice(0, 2).map((seat) => ({ ...seat, knownPlayerIds: seat.playerId === 7 ? [] : [7] }));
    await adapter.attach('session', { environment: 'civ5', gameId: 'game-contact', turn: 1, facts: {}, seats: contactSeats, normalizedState: {} }, actors, { 'human-seat': 3, 'llm-seat': 7 });
    const references = createSocialReferenceSet(actors, [{ id: 'world', sessionId: 'session', kind: 'world', title: 'WORLD', createdByActorId: 'human-seat', canonicalKey: 'world', createdAt: 'now', archived: false }]);
    const unseen = await adapter.filterReferencesForActor(actors[1], references);
    expect(unseen.actors.map((reference) => reference.id)).toEqual(['llm-seat']);
    await expect(adapter.isActorReachable(actors[1], 'human-seat')).resolves.toBe(false);
    await expect(adapter.ingest({ gameId: 'game-contact', turn: 1, type: 'UnknownFrameworkEvent', sourceKey: 'unknown', payload: {} })).resolves.toBe(false);
    expect(adapter.eventRecipientActorIds({ gameId: 'game-contact', turn: 1, type: 'UnknownFrameworkEvent', sourceKey: 'unknown', payload: {} })).toEqual([]);
    adapter.updateSnapshot({ environment: 'civ5', gameId: 'game-contact', turn: 2, facts: {}, seats: contactSeats.map((seat) => seat.playerId === 7 ? { ...seat, knownPlayerIds: [3] } : seat), normalizedState: {} });
    const seen = await adapter.filterReferencesForActor(actors[1], references);
    expect(seen.actors.map((reference) => reference.id)).toEqual(['human-seat', 'llm-seat']);
    await expect(adapter.isActorReachable(actors[1], 'human-seat')).resolves.toBe(true);
  });

  it('should refresh the live contact graph from cached player visibility without recreating the adapter', async () => {
    const adapter = new CivEnvironmentAdapter(new MemoryEnvironmentEventJournal());
    const parameters = { playerID: 7, turn: 1, gameStates: { 1: { turn: 1, players: { '3': 'Unmet Major Civilization', '7': { IsMajor: true } }, reports: {} }, 2: { turn: 2, players: { '3': { IsMajor: true }, '7': { IsMajor: true } }, reports: {} }, 3: { turn: 3, players: { '3': { IsMajor: true }, '5': { IsMajor: true }, '7': { IsMajor: true } }, reports: {} } } } as StrategistParameters;
    let liveTurn = 1;
    const player = { getCurrentTurn: () => liveTurn, getBaseParameters: () => parameters, getKnownPlayerIds: () => getKnownMajorPlayerIds(parameters, 7, liveTurn) } as unknown as VoxPlayer;
    await adapter.attach('session', { environment: 'civ5', gameId: 'game-refresh', turn: 1, facts: {}, seats: seats.slice(0, 2), normalizedState: {} }, actors, { 'human-seat': 3, 'llm-seat': 7 });
    await refreshCivContactGraph(adapter, (actorId) => actorId === 'civ-player-7' ? player : undefined);
    const references = createSocialReferenceSet(actors, [{ id: 'world', sessionId: 'session', kind: 'world', title: 'WORLD', createdByActorId: 'human-seat', canonicalKey: 'world', createdAt: 'now', archived: false }]);
    await expect(adapter.filterReferencesForActor(actors[1], references)).resolves.toMatchObject({ actors: [expect.objectContaining({ id: 'llm-seat' })] });
    liveTurn = 2;
    await refreshCivContactGraph(adapter, (actorId) => actorId === 'civ-player-7' ? player : undefined);
    await expect(adapter.filterReferencesForActor(actors[1], references)).resolves.toMatchObject({ actors: expect.arrayContaining([expect.objectContaining({ id: 'human-seat' })]) });
    await expect(adapter.isActorReachable(actors[1], 'human-seat')).resolves.toBe(true);
    expect(getKnownMajorPlayerIds(parameters, 7, 2)).toEqual([3]);
    expect(getKnownMajorPlayerIds(parameters, 7, 3)).toEqual([3, 5]);
  });

  it('should require a third-party observer to know both endpoints of a two-party event', async () => {
    const adapter = new CivEnvironmentAdapter(new MemoryEnvironmentEventJournal());
    const eventActors = [...actors, { id: 'egypt-seat', ordinal: 2, control: 'model' as const, displayName: 'Egypt', sessionId: 'session', createdAt: 'now', status: 'active' as const }];
    const eventSeats = [
      { ...seats[0], knownPlayerIds: [7] },
      { ...seats[1], knownPlayerIds: [3, 9] },
      { ...seats[2], nativeVpOnly: false, knownPlayerIds: [3, 7] },
    ];
    await adapter.attach('session', { environment: 'civ5', gameId: 'game-events', turn: 1, facts: {}, seats: eventSeats, normalizedState: {} }, eventActors, { 'human-seat': 3, 'llm-seat': 7, 'egypt-seat': 9 });
    const event = { gameId: 'game-events', turn: 1, type: 'WarDeclared', sourceKey: 'war-1', sourcePlayerId: 7, targetPlayerId: 9, payload: {} };
    expect(adapter.eventRecipientActorIds(event)).toEqual(['llm-seat', 'egypt-seat']);
    adapter.updateSnapshot({ environment: 'civ5', gameId: 'game-events', turn: 2, facts: {}, seats: eventSeats.map((seat) => seat.playerId === 3 ? { ...seat, knownPlayerIds: [7, 9] } : seat), normalizedState: {} });
    expect(adapter.eventRecipientActorIds({ ...event, sourceKey: 'war-2' })).toEqual(['human-seat', 'llm-seat', 'egypt-seat']);
  });

  it('should give distinct stable operation IDs to support reads with different arguments', async () => {
    const first = createSupportReadOperationId('intention-1', 0, 'get-cities', { Owner: 'Rome' });
    const second = createSupportReadOperationId('intention-1', 1, 'get-cities', { Owner: 'Greece' });
    expect(first).not.toBe(second);
    expect(first).toContain('intention-1');
    expect(second).toContain('get-cities');
    const execute = vi.fn(async (_binding: { playerId: number }, args: Record<string, unknown>) => ({ state: 'CONFIRMED' as const, resultSummary: JSON.stringify(args) }));
    const gateway = new CivActionGateway(new MemoryCivActionJournal());
    gateway.register('get-cities', { category: 'READ', execute });
    const binding = { sessionId: 'session', actorId: 'llm-seat', ordinal: 1, gameId: 'game-1', playerId: 7, civilizationType: 'CIVILIZATION_ROME_2', civilizationName: 'Rome', controlMode: 'llm' as const, active: true };
    await gateway.invoke(binding, 1, 'get-cities', { Owner: 'Rome' }, first);
    await gateway.invoke(binding, 1, 'get-cities', { Owner: 'Greece' }, second);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map((call) => call[1])).toEqual([{ Owner: 'Rome' }, { Owner: 'Greece' }]);
  });

  it('should bind acting identity structurally and make operation IDs idempotent', async () => {
    const gateway = new CivActionGateway(new MemoryCivActionJournal());
    const execute = vi.fn(async (binding: { playerId: number }) => ({ state: 'CONFIRMED' as const, resultSummary: `read for ${binding.playerId}` }));
    gateway.register('read-cities', { category: 'READ', execute });
    const binding = { sessionId: 'session', actorId: 'llm-seat', ordinal: 1, gameId: 'game-1', playerId: 7, civilizationType: 'CIVILIZATION_ROME_2', civilizationName: 'Rome', controlMode: 'llm' as const, active: true };
    const first = await gateway.invoke(binding, 4, 'read-cities', { detail: true }, 'op-1');
    const second = await gateway.invoke(binding, 4, 'read-cities', { detail: true }, 'op-1');
    expect(first).toEqual(second);
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(gateway.invoke(binding, 4, 'read-cities', { actingPlayerId: 7 }, 'op-2')).rejects.toThrow(/structurally bound/);
  });

  it('should route environment events to durable intentions without prescribing a reaction', async () => {
    const enqueueIntention = vi.fn(async (input: { kind: string; payload: string }) => ({ ...input }));
    const bridge = new CivEventBridge({ enqueueIntention } as never);
    const intention = await bridge.route({ gameId: 'game-1', turn: 6, type: 'city-lost', sourceKey: 'game-1:6:city-lost:7', payload: { cityId: 12 } }, 'llm-seat');
    expect(intention.kind).toBe('environment-event');
    expect(JSON.parse(intention.payload).type).toBe('city-lost');
    expect(enqueueIntention).toHaveBeenCalledTimes(1);
  });

  it('should serialize social and strategic reasoning through one actor lane', async () => {
    const adapter = new CivEnvironmentAdapter(new MemoryEnvironmentEventJournal());
    await adapter.attach('session', { environment: 'civ5', gameId: 'game-1', turn: 8, facts: {}, seats, normalizedState: { era: 'Medieval' } }, actors, { 'human-seat': 3, 'llm-seat': 7 });
    let active = 0;
    let maximum = 0;
    const executor = { decide: vi.fn(async (_actor: SocialActor, context: { system: string }) => { active += 1; maximum = Math.max(maximum, active); expect(context.system).toContain('game-1'); await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; return { outcome: 'pass' as const }; }) };
    const mind = new CivPlayerMind(new ActorLane(), new SocialContextBuilder(), executor, new CivContextProvider(adapter));
    const intention = { id: 'i', actorId: 'llm-seat', kind: 'strategic-review', channelId: null, sourceMessageId: null, priority: 1, state: 'queued' as const, notBefore: 'now', payload: null, dedupeKey: null, attemptCount: 0, lastError: null, createdAt: 'now', updatedAt: 'now' };
    await Promise.all([mind.reason(actors[1], 'social-reply', { actors, messages: [], intention }), mind.reason(actors[1], 'strategic-review', { actors, messages: [], intention })]);
    expect(maximum).toBe(1);
    expect(executor.decide).toHaveBeenCalledTimes(2);
  });

  it('should persist bindings and action idempotency while using the existing MCP port', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vox-deorum-civ-persistence-')); const store = new SocialStore(join(directory, 'social.sqlite'));
    const persistentActors = actors.slice(0, 2).map((actor) => ({ ...actor, sessionId: 'persistent' })); await store.createSession({ id: 'persistent', humanActorId: 'human-seat' }, persistentActors);
    const notifications: Array<(event: GameEventNotification) => void> = []; const calls: Array<{ name: string; args: Record<string, unknown> }> = []; const port: CivMcpPort = { getTools: async () => [{ name: 'get-players' }, { name: 'get-cities' }, { name: 'reject-agent-deal' }] as never, callTool: async (name, args = {}) => { calls.push({ name, args }); return { structuredContent: { Result: 'rejected' } }; }, onNotification: (handler) => { notifications.push(handler); return () => { const index = notifications.indexOf(handler); if (index >= 0) notifications.splice(index, 1); }; } };
    const events = vi.fn(async () => undefined); const adapter = new CivEnvironmentAdapter(new SocialStoreEnvironmentEventJournal(store, 'persistent', 'civ5'), events, { list: (sessionId, environmentType, gameId) => store.listEnvironmentBindings(sessionId, environmentType, gameId), reconcile: (bindings) => store.reconcileEnvironmentBindings(bindings.map((binding) => ({ ...binding, environmentType: 'civ5' }))) }); const snapshot = { environment: 'civ5' as const, gameId: 'game-persist', turn: 3, facts: {}, seats: seats.slice(0, 2), normalizedState: { era: 'Classical' } };
    await adapter.attach('persistent', snapshot, persistentActors, { 'human-seat': 3, 'llm-seat': 7 }); adapter.start(port); notifications[0]?.({ event: 'CityFounded', playerID: 7, turn: 3, latestID: 22, gameID: 'game-persist', PlayerID: 7, Turn: 3, data: { cityId: 4, hiddenSocialText: 'do not persist' } }); await new Promise((resolve) => setTimeout(resolve, 0)); expect(events).toHaveBeenCalledTimes(1); expect(JSON.stringify(events.mock.calls[0]?.[0])).not.toContain('hiddenSocialText');
    const gateway = new CivActionGateway(new SocialStoreCivActionJournal(store)); await registerExistingCivCapabilities(gateway, port); const binding = adapter.binding('llm-seat'); const first = await gateway.invoke(binding, 3, 'get-players', {}, 'operation-1'); expect(first.state).toBe('CONFIRMED'); expect(calls[0]).toEqual({ name: 'get-players', args: { PlayerID: 7 } }); const native = await gateway.invoke(binding, 3, 'reject-agent-deal', { targetPlayerId: 3, proposalMessageId: 42 }, 'operation-2'); expect(native.state).toBe('CONFIRMED'); expect(calls[1]).toMatchObject({ name: 'reject-agent-deal', args: { PlayerAID: 7, PlayerBID: 3, SpeakerID: 7, ProposalMessageID: 42, ExpectedGameID: 'game-persist' } });
    await store.close(); const reopened = new SocialStore(join(directory, 'social.sqlite')); const gatewayAfterRestart = new CivActionGateway(new SocialStoreCivActionJournal(reopened)); await registerExistingCivCapabilities(gatewayAfterRestart, port); const second = await gatewayAfterRestart.invoke(binding, 3, 'get-players', {}, 'operation-1'); expect(second.state).toBe('CONFIRMED'); expect(calls.filter((call) => call.name === 'get-players')).toHaveLength(1); const adapterAfterRestart = new CivEnvironmentAdapter(new SocialStoreEnvironmentEventJournal(reopened, 'persistent', 'civ5')); await adapterAfterRestart.attach('persistent', snapshot, persistentActors, { 'human-seat': 3, 'llm-seat': 7 }); await expect(adapterAfterRestart.ingest({ gameId: 'game-persist', turn: 3, type: 'CityFounded', sourceKey: 'game-persist:22', sourcePlayerId: 7, payload: { cityId: 4 } })).resolves.toBe(false); adapter.detach(); await reopened.close(); rmSync(directory, { recursive: true, force: true });
  });
});
