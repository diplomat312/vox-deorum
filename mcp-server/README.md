# MCP Server

The MCP server exposes Civilization V's game state and controls to AI agents as Model Context Protocol tools. It sits above the Bridge Service, which it uses to read and act on the live game, and below the Vox Agents that connect to it as MCP clients.

## Commands

Install dependencies from the repository root, since this is an npm workspace (see [setup.md](../docs/developers/setup.md)):

```bash
npm install
```

Then, from this directory:

```bash
npm run build   # compile to dist/
npm run dev     # watch mode with hot reload
npm test        # run the test suite
```

## Documentation

- [Developer guide](../docs/developers/mcp-server/overview.md) for what the server does, how its tools and managers fit together, and how it sits in the stack
- Component reference: [tool reference](docs/tools.md), [knowledge system](docs/knowledge.md), and further reference data under `docs/events/`, `docs/flavors/`, `docs/influence/`, and `docs/strategies/`
- [Generated TypeDoc API reference](docs/api/README.md)
- [AGENTS.md](AGENTS.md) for internal development conventions
