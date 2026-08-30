/**
 * @module strategist/pacing/registry
 *
 * Registry for pacing interruption strategies.
 */
import { createLogger } from "../../utils/logger.js";
import { ImportantEventsPacingInterruption } from "./important-events.js";
import { NonePacingInterruption } from "./none.js";
import { WorldChatPacingInterruption } from "./world-chat.js";
/**
 * In-memory registry mapping interruption names to their strategy objects.
 * Acts as the single source of truth consumed by pacing.ts (decision logic),
 * the web API, and the config UI.
 */
class PacingInterruptionRegistry {
    logger = createLogger("PacingInterruptionRegistry");
    strategies = new Map();
    defaultsInitialized = false;
    /**
     * Register (or replace) a strategy keyed by its `name`.
     * @returns True if newly added, false if it replaced an existing strategy.
     */
    register(strategy) {
        const isReplacement = this.strategies.has(strategy.name);
        if (isReplacement) {
            this.logger.warn(`Pacing interruption ${strategy.name} is already registered, replacing existing strategy`);
        }
        this.strategies.set(strategy.name, strategy);
        this.logger.info(`Pacing interruption registered: ${strategy.name} - ${strategy.description ?? strategy.label}`);
        return !isReplacement;
    }
    /**
     * Remove a strategy by name.
     * @returns True if a strategy was removed, false if the name was unknown.
     */
    unregister(name) {
        const wasDeleted = this.strategies.delete(name);
        if (wasDeleted) {
            this.logger.info(`Unregistered pacing interruption ${name} (remaining strategies: ${this.strategies.size})`);
        }
        return wasDeleted;
    }
    /** Look up a single strategy by name, or undefined if not registered. */
    get(name) {
        return this.strategies.get(name);
    }
    /** Return all registered strategies (used to populate the config UI). */
    getAll() {
        return Array.from(this.strategies.values());
    }
    /** Return just the registered strategy names. */
    getNames() {
        return Array.from(this.strategies.keys());
    }
    /** Whether a strategy is registered under the given name. */
    has(name) {
        return this.strategies.has(name);
    }
    /**
     * Remove all registered strategies and reset the defaults guard so a later
     * {@link initializeDefaults} call re-registers the built-ins.
     */
    clear() {
        this.strategies.clear();
        this.defaultsInitialized = false;
    }
    /**
     * Register built-in interruption strategies. Add future built-ins here so
     * pacing.ts and the UI continue to discover strategies through the registry.
     */
    initializeDefaults() {
        if (this.defaultsInitialized)
            return;
        this.register(new NonePacingInterruption());
        this.register(new ImportantEventsPacingInterruption());
        this.register(new WorldChatPacingInterruption());
        this.defaultsInitialized = true;
    }
}
export const pacingInterruptionRegistry = new PacingInterruptionRegistry();
pacingInterruptionRegistry.initializeDefaults();
//# sourceMappingURL=registry.js.map
