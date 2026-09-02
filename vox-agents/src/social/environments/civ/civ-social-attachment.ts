import type { SocialEnvironmentPort } from '../../runtime/social-environment-port.js';
import type { SocialRuntime } from '../../runtime/social-runtime.js';
import { CivContextProvider } from './civ-context-provider.js';
import type { CivEnvironmentAdapter, CivSnapshot } from './civ-environment-adapter.js';
import { SocialStoreEnvironmentEventJournal } from '../environment-event.js';
import { SocialStoreCivActionJournal, CivActionGateway } from './civ-action-gateway.js';
import { CivEventBridge } from './civ-event-bridge.js';
import { mcpCivPort, type CivMcpPort } from './civ-mcp-port.js';
import { registerExistingCivCapabilities } from './civ-mcp-capabilities.js';

/** Attach Civ to an already-created social session through the generic environment boundary. */
export async function attachCivEnvironment(runtime: SocialRuntime, adapter: CivEnvironmentAdapter, snapshot: CivSnapshot, actorSeatById: Record<string, number>, port: CivMcpPort = mcpCivPort): Promise<void> {
  const store = runtime.getSocialStoreForEnvironment();
  const sessionId = runtime.getSessionId();
  const eventBridge = new CivEventBridge({ enqueueIntention: (input) => runtime.enqueueIntention(input) });
  adapter.configurePersistence(new SocialStoreEnvironmentEventJournal(store, sessionId, snapshot.environment), { list: (id, environmentType, gameId) => store.listEnvironmentBindings(id, environmentType, gameId), reconcile: (bindings) => store.reconcileEnvironmentBindings(bindings.map((binding) => ({ ...binding, environmentType: snapshot.environment }))) }, async (event) => {
    const liveActors = await runtime.listActors();
    const recipients = new Set(adapter.eventRecipientActorIds(event));
    if (event.actorId) recipients.add(event.actorId);
    for (const actor of liveActors) if (actor.control === 'model' && recipients.has(actor.id)) await eventBridge.route(event, actor.id);
  });
  await adapter.attach(sessionId, snapshot, await runtime.listActors(), actorSeatById);
  const context = new CivContextProvider(adapter);
  const gateway = new CivActionGateway(new SocialStoreCivActionJournal(store));
  await registerExistingCivCapabilities(gateway, port);
  await gateway.recover(sessionId);
  const environment: SocialEnvironmentPort = {
    contextForActor: (actor) => context.forActor(actor),
    decisionDefinitionsForActor: async () => gateway.modelDecisionDefinitions(),
    execute: async (actor, turn, actionName, argumentsValue, operationId) => ({ state: (await gateway.invoke(adapter.binding(actor.id), turn, actionName, argumentsValue, operationId)).state }),
    close: () => adapter.detach(),
  };
  runtime.attachEnvironment(environment);
  adapter.start(port);
}
