# Playing

Once a game is running, civilizations under Vox Deorum's control no longer run on Civ V's built-in AI. Each one is instead steered by a language model. This page describes what that feels like in practice: what the AI does, how to talk to it, and what to expect.

## What the AI does

A normal Civ V opponent follows fixed rules. A Vox Deorum opponent **thinks about its situation and decides how to play**. The underlying software calls this AI a strategist, a term you may see in logs or configuration.

By default, each AI civilization re-evaluates every single turn. It looks at the whole board: its cities and military, the other players, how the victory race is going, and recent events. It then sets a direction for its empire: which victory to chase, what to research, which social policies to pursue, and how to feel about its neighbors.

- **The AI guides, it doesn't micromanage.** It plays at the level of a human thinking, "I should turn toward a science victory and make peace with my eastern neighbor," not "move this archer one tile." Unit-by-unit moves and city management stay with Civ V's built-in AI.
- **Decisions can be paced out.** Instead of that every-turn default, a game can be set up so the AI decides only every few turns, holding its course until then, and optionally reconsidering early whenever something important happens: a war or peace declaration, a finished technology, an adopted policy or ideology, or an important message relayed by a diplomat. On the turns in between, it is deliberately staying the course, not ignoring you.
- **Every decision has a reason.** When the AI changes direction, it records *why* in plain language. You see those rationales in the game (below), and you can review the full reasoning afterward in [Replay](replay.md).

You can have the AI run several civilizations at once, play alongside it as a normal human player, or simply watch a game where every major civilization is AI-driven. This is set by the configuration you pick when you start the game.

## Seeing the AI's reasoning in-game

Vox Deorum adds almost no new windows to the game, speaking instead through surfaces Civ V already has.

- **The replay log.** As the AI makes its moves, it writes a short summary and the reasoning behind each one into the player's replay messages. When you review the game later, they read as a running account of *why* each civilization did what it did, not just the bare facts the game normally records.
- **The top panel.** As decisions land, the game's top panel switches to whichever civilization just acted, so your attention follows whoever is making a move.

## Chatting with spokespersons

Each AI civilization can field a **spokesperson**, who talks for it in character. Open a civilization's chat from inside the game and ask what it thinks of you, how it sees the world, what it intends to do. A civilization may instead field a **diplomat**, who plays the same role but also takes note: what you reveal in conversation may reach its leader and color how it treats you later.

A spokesperson has no authority to agree to anything; it only conveys positions. Raise a deal with a diplomat, though, and it comes back with a concrete proposal on the game's own deal screen, which you can accept or decline.

**Talk to a spokesperson to learn about a civilization; talk to a diplomat and the civilization may learn about you.**

Conversations live in threads that persist as the game goes on. The spokesperson keeps track of time along with you: it knows which turn it is, and that turns have gone by since you last spoke. The words come from the language model in real time, so replies stream in as they are written.

## What to expect

- **The AI is genuinely making its own choices.** It can surprise you: change course, hold a grudge, pursue an unexpected victory. That unpredictability is the point.
- **Response speed and quality both depend on the model you choose.** Turn decisions and spokesperson replies alike call the language model, so expect a short wait each time; faster or local models cut that wait, while a stronger model plays a sharper game and holds a better conversation. See [Configuration](configuration.md) to weigh quality against speed and cost.

If the AI seems stuck, a turn hangs, or chat doesn't respond, see [Troubleshooting](troubleshooting.md).
