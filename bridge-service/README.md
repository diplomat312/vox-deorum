# Bridge Service

The Bridge Service is the REST/SSE layer between Civilization V's Community Patch DLL and the rest of the Vox Deorum stack. It connects to the DLL over a Windows named pipe and re-exposes game calls and events as HTTP and Server-Sent Events for the MCP server above it.

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

- [Developer guide](../docs/developers/bridge-service/overview.md) for what the service does, its lifecycle, and how it fits the stack
- Component reference: [API reference](docs/api-reference.md), [message types](docs/message-types.md), [protocol](docs/protocol.md), [event pipe](docs/event-pipe.md)
- [Generated TypeDoc API reference](docs/api/README.md)
- [AGENTS.md](AGENTS.md) for internal development conventions
