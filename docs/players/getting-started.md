# Getting Started

Vox Deorum lets you play Civilization V (Civ V) against opponents run by large language models (LLMs) such as GPT, Claude, and Gemini. The AI civilizations make their own strategic decisions and can talk to you in character. This page walks you through installing Vox Deorum and starting your first game.

The path is short: install, then launch. Civ V must already be installed through Steam; the installer handles the mods and other dependencies for you.

## What you need

| Requirement | Details |
| --- | --- |
| Windows | Windows 10 or 11. |
| [Civilization V](https://store.steampowered.com/app/8930/) | Already installed through Steam. Ideally with both expansions, *Gods & Kings* and *Brave New World*. Vox Deorum is built on the [Community Patch and Vox Populi](https://github.com/LoneGazebo/Community-Patch-DLL) overhaul and is only tested with the full game. |
| An LLM API key | A key from OpenAI, Anthropic, Google, OpenRouter, or another supported service, which powers the AI players. Most providers charge for usage; you can instead point Vox Deorum at a free local model. See [Configuration](configuration.md). |

## Install

1. **Download the installer.** Grab the newest release from the [releases page](https://github.com/CIVITAS-John/vox-deorum/releases).
2. **Run the installer.** It looks for your Steam and Civ V folders on its own, then installs everything Vox Deorum needs:
   - The Vox Deorum game mods: the Community Patch, Vox Populi, the Vox Deorum mod itself, and the matching interface files.
   - A bundled copy of Node.js for the AI services to run on, so you don't have to set it up yourself.

   It asks you to confirm the Civ V folder, pre-filled if the search succeeded, and won't continue until you choose a valid one. The typical location is `Steam\steamapps\common\Sid Meier's Civilization V`.

You'll add your API key at first launch (see below).

## First launch

Start Vox Deorum from the **Start Menu** entry named *Vox Deorum*, or by running `scripts\vox-deorum.cmd` in the install folder.

A console window opens and starts the background services, then brings up the dashboard in your web browser (by default at `http://localhost:5555`).

**Leave the console window running.** Closing it shuts everything down. When you are done, follow the prompt in the console to stop cleanly.

From the dashboard:

1. On a fresh install, the dashboard opens its **Settings** page automatically so you can paste in your provider's key. You can return here any time to add or change keys without editing any files.
2. Open the **Play** page and set up your game: assign the AI to numbered player slots (the game picks each slot's civilization), choose whether you play alongside it or just watch, then start the game. Vox Deorum launches Civ V with the mods already enabled, so you don't need to touch the game's own mod menu.
3. Civ V opens into your game. Play as you normally would: an LLM now drives the AI civilizations, and they steer their empires on their own each turn.

That's it. You are playing. From here:

- **[Playing](playing.md)** explains what the AI does each turn and how to chat with the AI civilizations' spokespersons.
- **[Configuration](configuration.md)** covers choosing providers and models, controlling cost, and running local models.
- **[Replay](replay.md)** shows how to rewatch a finished game.
- **[Troubleshooting](troubleshooting.md)** collects fixes for the most common snags.
