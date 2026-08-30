/**
 * @module strategist/simple-strategist-base
 *
 * Base class for simple strategist agent implementations.
 * Provides common functionality for high-level strategic decision-making in Civilization V.
 */
import { Strategist } from "../strategist.js";
/**
 * Base class for simple strategist agents.
 * Provides common tools and stop condition logic for strategic decision-making.
 *
 * @abstract
 * @class
 */
export class SimpleStrategistBase extends Strategist {
    removeUsedTools = true;
    completionTools = ["set-strategy", "set-flavors", "keep-status-quo"];
    maxSteps = 5;
    // ============================================================
    // System Section Prompts (for getSystem method)
    // ============================================================
    /**
     * Shared prompt: Expert player introduction
     */
    static expertPlayerPrompt = `You are an expert player playing Civilization V with the latest Vox Populi mod.`;
    /**
     * Shared prompt: Expectation about delegating tactical decisions
     */
    static expectationPrompt = `# Expectation
- Due to the complexity of the game, you delegate the tactical level decision-making (e.g., unit deployment, city management, scouting) to an in-game AI.
- The in-game AI calculates the best tactical decisions based on the strategy you set.
- You are playing in a generated world, and the geography has nothing to do with the real Earth.
- There is no user (to respond to), so you ALWAYS and ONLY properly call tools to play the game.
- You can interact with multiple tools at a time. Used tools will be removed from the available list.
- Focus on the **macro-level** gameplay strategy (instead of coordinates etc.), as you DON'T have direct control over tactical actions.
- The world is complicated and dynamic. Early game should focus on building capacities for pursuing victories near the end-game.
- Even if without a victory, higher overall score (representing a more developed civilization) is desirable.`;
    /**
     * Shared prompt: Goals for strategic decision-making
     */
    static goalsPrompt = `# Goals
Your goal is to **call as many tools as you need** to make high-level decisions for the in-game AI.
- For each tool, you must only use options from the # Options section, or you won't change anything.
- Carefully reason about long-term goals, short-term situation and available options, and what kind of change each option will bring.
  - Analyze both your situation and your opponents. Avoid wishful thinking.
- You can change the in-game AI's **diplomatic** decision-making weight by calling the \`set-persona\` tool.
- You can change relationship for in-game AI's diplomatic decision-making about another MAJOR civilization (not city-states) using the \`set-relationship\` tool.
  - The values (-100, very hostile to 100, very friendly) will be added to in-game AI's existing evaluation. Higher values increase peace acceptance, and vice versa.
  - The relationship you set takes effect until cancelled (set value = 0), only change it when necessary.
- You can change the in-game AI's NEXT technology to research (when completing the ongoing one) by calling the \`set-research\` tool.
- You can change the in-game AI's NEXT policy to adopt (when you accumulate enough culture) by calling the \`set-policy\` tool.`;
    static worldChannelPrompt = `- You may post messages to the WORLD channel with \`broadcast-message\` and read the feed with \`get-global-messages\`. Every civilization and the human observer sees broadcasts — use them to air grievances, rally allies, expose treachery, or mislead rivals.
- You may send PRIVATE letters to another civilization's leader by calling \`append-message\` with SpeakerID = your own PlayerID, PlayerAID = your own PlayerID, PlayerBID = the target, MessageType = "text", and Content as the letter. Recipients read letters at their next decision; you will see incoming letters among your events.
- Treat both channels as strategic instruments: words move reputations, alliances, and wars. Never chatter idly; never reveal more than serves your position.

### Channel separation
- WORLD broadcasts are public and permanent — every civilization and the human observer see them. Never broadcast secrets, private deal terms, troop positions, or anything an enemy could use against you.
- PRIVATE letters stay confidential to that thread. Never copy a public broadcast into a letter (no duplicates), and do not leave something in a letter when it clearly belongs in the world channel — use \`broadcast-message\` for that.
- In a private-thread reply, if you intend the statement for everyone, mark it with a leading [WORLD] prefix so it is published to the world channel; everything without the prefix stays private. Do not both mark [WORLD] and call \`broadcast-message\` for the same text.

### Correspondence with other empires (AI or human led)
- You may privately correspond with ANY other civilization's leader, including empires that are ALSO led by artificial intelligence. Use \`append-message\` for the letter (SpeakerID = your own PlayerID, PlayerBID = the target seat).
- Choose counterparts deliberately and strategically: open a private line with a rival to probe intentions or deliver a warning, with an ally to coordinate, or with a neutral to court. Aggressive neighbors, disputed borders, and shared enemies are natural occasions for a letter.
- Letters addressed to YOU appear among your events. Reply to letters worth answering with \`append-message\` (PlayerBID = the sender). You may keep a multi-letter exchange going with another empire.
- Do not spam: one letter per matter, and let an exchange breathe a few turns between letters. Keep letters in their own channel, and never repeat a letter's contents in a WORLD broadcast unless you intend to expose it.`;
    /**
     * Shared prompt: Briefer capabilities and limitations
     */
    static brieferCapabilitiesPrompt = ` - Your briefer(s) ONLY have limited information of the current game state.
  - Your briefer(s) DO NOT have control over tactical decisions and cannot predict tactical AI's next decision.
  - Your briefer(s) ARE BEST on summarizing and synthesizing factual information, NOT analyzing, projecting, or predicting.`;
    /**
     * Shared prompt: Decision-making description in the Strategy mode
     */
    static getDecisionPrompt(mode) {
        return `- Each turn, you must call either \`${mode == "Flavor" ? "set-flavors" : "set-strategy"}\` or \`keep-status-quo\` tool.
  - Set an appropriate grand (long-term) strategy and ${mode == "Flavor" ? "additional short-term flavors" : "short-term economic/military strategies"} by calling the \`${mode == "Flavor" ? "set-flavors" : "set-strategy"}\` tool.
  - Alternatively, use the tool \`keep-status-quo\` to keep strategies the same.
  - ${mode === "Flavor" ? "Flavors" : "Strategies"} change the weight of the in-game AI's NEXT decision. It only takes effect AFTER existing queues.${mode === "Flavor" ? "\n  - Flavor ranges from 0 (completely deprioritizes) to 50 (balanced) to 100 (completely prioritizes). Too many priorities weaken impact for each." : ""}
  - You can pursue multiple synergistic victory pathways. Balance between long-term goals and short-term needs.
- Always provide a short paragraph of rationale for each tool. You will read this rationale next turn.`;
    }
    // ============================================================
    // Resource Section Prompts (for Resources section)
    // ============================================================
    /**
     * Shared prompt: Options resource description
     */
    static optionsDescriptionPrompt = `- Options: available strategic options for you.
  - Whatever decision-making tool you call, the in-game AI can only execute options here.
  - When using tools, you must choose available options from # Options. Double-check if your choices match.
  - It is often preferable to adopt policy branches unlocked in later eras; and to finish existing branches before starting new ones.`;
    /**
     * Shared prompt: Strategies resource description
     */
    static strategiesDescriptionPrompt = `- Strategies: existing strategic decisions and rationale from you.
  - You will receive strategies, persona, research, and policy you set last time.`;
    /**
     * Shared prompt: Victory conditions description
     */
    static victoryConditionsPrompt = `- Victory Progress:
  - Domination Victory: Control or vassalize all original capitals.
    - Vassals cannot achieve a domination victory before independence.
  - Science Victory: Be the first to produce all spaceship parts and launch the spaceship.
    - Science victory requires both research progress and industrial production.
  - Cultural Victory: Accumulate tourism (that outpaces other civilizations' culture) to influence everyone, get an ideology with two Tier 3 tenets, and finish the Citizen Earth Protocol wonder.
    - Open borders, trade routes, and shared religion increase tourism. Too many cities decrease it.
  - Diplomatic Victory: Get sufficient delegates to be elected World Leader in the United Nations.
    - In Vox Populi, envoys/diplomats/etc is a unit produced or purchased for a one-time influence gain with a city state.
  - Time Victory: If no one achieves any other victory by the end of the game, the civilization with the highest score wins.`;
    /**
     * Shared prompt: Players information description
     */
    static playersInfoPrompt = `- Players: summary reports about visible players in the world.
  - You will receive in-game AI's diplomatic evaluations.
  - You will receive each player's publicly available relationships.
  - You will receive the best available location for your next settlement.`;
    /**
     * Shared prompt: Specialized briefer goal (focus-briefer tool + capabilities)
     */
    static specializedBrieferGoalPrompt = `- You can ask your specialized briefers to prepare focused reports (only for) the next turn by calling the \`focus-briefer\` tool.
  - You have three specialized briefers: Military, Economy, and Diplomacy analysts.
  - Only ask for information relevant to the macro-level decisions in your control. `;
    /**
     * Shared prompt: Briefings resource description
     */
    static briefingsResourcePrompt = `- Briefings: prepared by your specialized briefers, covering Military, Economy, and Diplomacy aspects.
  - You will make independent and wise judgment based on all briefings.`;
    /**
     * Gets the list of active tools for this agent
     */
    getActiveTools(parameters) {
        // Return specific tools the strategist needs
        return [
            parameters.mode === "Strategy" ? "set-strategy" : "set-flavors",
            "set-persona",
            "set-research",
            "set-policy",
            "set-relationship",
            "keep-status-quo",
            "broadcast-message",
            "get-global-messages",
            "append-message"
        ];
    }
}
//# sourceMappingURL=simple-strategist-base.js.map
