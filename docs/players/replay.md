# Replay

Every Civilization V game you finish leaves behind a replay file, Vox Deorum games included. The **Vox Deorum Replayer** is a browser-based tool for rewatching finished games, yours and the AI's alike. There is nothing to install.

The Replayer is built for [Community Patch and Vox Populi](https://github.com/LoneGazebo/Community-Patch-DLL) games, the ruleset Vox Deorum uses, so your Vox Deorum replays load correctly. Plain, unmodded Civ V replays may not.

To watch a replay:

1. Open the Replayer at <https://civitas-john.github.io/vox-deorum-replay/>.
2. [Find your replay file](#finding-your-replay-files).
3. [Load it](#loading-a-game).
4. [Play it back](#watching-a-game).

## Finding your replay files

Civilization V writes a `.Civ5Replay` file for each completed game. On Windows you'll find them under your Documents folder:

```text
Documents\My Games\Sid Meier's Civilization 5\Replays\
```

## Loading a game

There are two ways to load a replay:

- **Drag and drop.** Drag a `.Civ5Replay` file straight onto the Replayer page.
- **Direct link.** Point the Replayer at a hosted file with a URL like `?file=<url>&turn=<number>`, which is handy for sharing a specific moment with someone else.

The Replayer also ships with a few example replays of AI games, in case you want to see it in action before loading your own.

## Watching a game

Once a replay is loaded, play it back turn by turn to watch the map evolve:

| Control | Action |
| --- | --- |
| Space | Play and pause |
| Arrow keys | Step or scrub through the turns |
| Number keys 1–5 | Change playback speed |
| Zoom | Move between the whole-map view and a closer look |

## Reviewing the AI's reasoning

The Replayer shows you *what* happened on the map. For the *why*, each AI civilization records the reasoning behind its decisions into the replay log as the game runs (see [Playing](playing.md)). Reviewing a finished game therefore gives you both the events and the thinking behind them.
