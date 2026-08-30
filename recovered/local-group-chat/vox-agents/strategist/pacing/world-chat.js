/**
 * @module strategist/pacing/world-chat
 *
 * Pacing interruption that combines the standard important-events triggers with
 * correspondence: a strategist is woken when it receives a letter or when anyone
 * broadcasts into the world channel. The strategic layer can then react to the
 * living world within a turn or two of the message, without re-pacing every turn.
 */
import { ImportantEventsPacingInterruption } from "./important-events.js";
import { flattenEvents } from "./utils.js";
export class WorldChatPacingInterruption {
    constructor() {
        this.important = new ImportantEventsPacingInterruption();
    }
    name = "worldChat";
    label = "World events & correspondence";
    description = "Force a decision on important game events and whenever this player receives a letter or a world-channel broadcast arrives.";
    shouldInterrupt({ state, playerID }) {
        if (this.important.shouldInterrupt({ state, playerID }))
            return true;
        const events = flattenEvents(state.events);
        for (const event of events) {
            if (event.Type === "GlobalMessage")
                return true;
            if (event.Type === "Letter" && event.SpeakerID !== undefined && event.SpeakerID !== playerID)
                return true;
        }
        return false;
    }
}
