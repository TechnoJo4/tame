# working on tame

this file is for your context if you're working on this repo (human or agent)

## what is tame?

tame is a minimal ai agent harness written in typescript targeting the deno runtime.

core tenets:
- **slim core**: it's just a pure agent loop. no tools. no interface. bring your own I/O.
- **isolation**: if you don't want a feature, disable the plugin and it doesn't exist anymore. no feature-flag-like dead code. each plugin has its own config file.

core concepts:

- **harness** (`packages/core/agent/harness.ts`): singleton that holds tools + plugins, creates agents. one harness per process.
- **thread** (`packages/sdk/util/thread.ts`): abortable work queue. serializes async functions.
- **emitter** (`packages/sdk/util/emitter.ts`): thread-based event queue. event handler (`T => Promise<T>`) can be added `before`, `after`, `once`. handlers modify event data. `fire` just adds to queue (non-blocking), `do` waits and returns the final modified event.
- **agent** (`packages/core/agent/agent.ts`): a single conversation session. owns the message context, an llm provider, tools, and plugin data. extends emitter, events: `userMessage`, `completion`, `assistantMessage`, `toolResult`, `idle`.
- **plugin** (`packages/sdk/agent/plugin.ts`): hooks into `init(harness)` and `newAgent(agent)`. plugins register tools, add event handlers, and store data in `agent.pluginData`.
- **tool** (`packages/sdk/agent/tool.ts`): name, description, typebox args schema, exec function, optional view functions (for e.g. compaction, acp rendering).
- **llm provider** (`packages/sdk/llm/types.ts`): `InferenceProvider` interface. implements `complete(req, signal?) -> AssistantMessage`. wrapped with rate limiters and request data injectors.
- **ratelimiter** (`ratelimit/ratelimit.ts`): `error()`, `success()`, `retryAfter(date)`, `delay()`, `wait()`.

the agent event lifecycle:

```
userMessage → completion → assistantMessage → [toolResult → completion → assistantMessage → ...] → idle
```

- `userMessage` is fired by the connector (acp, or programmatically). the message is appended to context and `completion` is queued.
- `completion` fires when the agent should call the llm. it's re-queued after tool results if there are no pending tool calls.
- `assistantMessage` is fired with the llm response. if it contains tool_use blocks, a user message with empty content is pushed as a placeholder, and each tool is executed.
- `toolResult` is fired for each tool execution. results are appended to the placeholder user message. once all tools for a turn are done, `completion` is re-queued.
- `idle` fires when the llm responds with a stop reason (end_turn, etc.), on abort, or on error.

## repo structure

```
tame/
├── deno.json             # workspace root: shared imports, lint, fmt
├── deno.lock             # shared lockfile
├── packages/
│   ├── sdk/              # @tame/sdk — interfaces, types, utilities
│   │   ├── mod.ts            # re-exports everything
│   │   ├── agent/
│   │   │   ├── interfaces.ts # IAgent, IHarness, event types
│   │   │   ├── plugin.ts     # Plugin interface
│   │   │   └── tool.ts       # Tool, AnyTool, tool()
│   │   ├── config/
│   │   │   ├── index.ts      # tameDataFolder, readTameConfig
│   │   │   └── validate.ts   # readConfig
│   │   ├── llm/
│   │   │   └── types.ts      # message types, InferenceProvider
│   │   └── util/             # emitter, thread, validation, symbols
│   ├── core/             # @tame/core — implementations
│   │   ├── index.ts          # entry point
│   │   ├── agent/            # Agent, Harness implementations
│   │   ├── config/           # config parsing, llm provider setup
│   │   ├── llm/              # inference provider implementations
│   │   ├── ratelimit/        # rate limiter implementations
│   │   ├── schemas/          # generated plugin config schemas
│   │   └── scripts/          # utility scripts
│   ├── plugin-acp/       # agent client protocol
│   ├── plugin-assisted-by/# git assisted-by trailer
│   ├── plugin-commands/  # slash command registry
│   ├── plugin-compact/   # context compaction
│   ├── plugin-debug/     # debug logging
│   ├── plugin-history/   # session persistence
│   ├── plugin-jina-fetch/# web page fetching
│   ├── plugin-memory/    # remember/forget tools
│   ├── plugin-ops/       # file & shell operations
│   ├── plugin-rpc/       # json-based rpc
│   ├── plugin-rpc-ws/    # websocket rpc transport
│   ├── plugin-skills/    # agent skills
│   ├── plugin-system-load/# system prompt prepend
│   └── plugin-tavily-search/# web search
└── .docs/                # design docs
```

## plugin loading

plugins are resolved from the `plugins` array in `config.json`. resolution order:

1. **direct path** — if the entry starts with `./` or `/`, it's treated as a filesystem path to a module with a default export (the plugin instance).
2. **bare specifier** — if it contains `/` (e.g. `@tame/plugin-memory`), imported as-is as a Deno workspace package or npm/jsr package.
3. **directory search** — otherwise, each directory in `pluginSources` (defaults to `[~/.tame/plugins]`) is searched for `<name>/main.ts`.
4. **fallback** — tries `@tame/plugin-<name>` as a bare specifier.

the `pluginSources` config field lets you add custom directories for your own plugins:

```json
{
  "plugins": ["memory", "@tame/plugin-compact", "./my-custom-plugin/main.ts"],
  "pluginSources": ["~/.tame/plugins", "~/dev/my-plugins"]
}
```

## plugin architecture

each plugin directory contains:

- `index.ts` — exports the plugin class and optionally its config schema (typebox). this is the plugin's public api; other plugins import from here to interoperate.
- `main.ts` — default-exported plugin instance, constructed with config. this is what the harness loads.
- `README.md` — usage docs (optional but encouraged)

plugins communicate via `harness.getPlugin<T>(id)`. this is the intended interop mechanism. plugins should not import each other's internals directly unless they own the dependency (e.g., `ops` owns the `Env` interface; `acp` owns `ACPAdapter`).

### how to write a plugin

1. create `plugins/<name>/index.ts`:

```ts
import { Plugin, tool, Type, type IAgent, type IHarness } from "@tame/sdk";

export class MyPlugin implements Plugin {
    id = "my-plugin" as const;

    async init(harness: IHarness) {
        // register tools, hook into other plugins
        harness.addTools(myTool);
    }

    newAgent(agent: IAgent) {
        // per-agent setup: add event handlers, init pluginData
        agent.pluginData.set(someKey, {});
    }
}
```

2. create `plugins/<name>/main.ts`:

```ts
import { readTameConfig } from "@tame/sdk";
import { configSchema, MyPlugin } from "./index.ts";

export default new MyPlugin(readTameConfig("my-plugin.json", configSchema));
```

3. add `"my-plugin"` to `plugins` in `config.json`.

### plugin config

use typebox for config schemas. plugins that need config should export `configSchema` from `index.ts` and use `readTameConfig("filename.json", configSchema)` in `main.ts`. config files live in `~/.tame/`. there's no hot-reload — restart to pick up changes.

### plugin data

`agent.pluginData` is a `Map<symbol, unknown>`. use a module-level `Symbol()` as the key. this is per-agent state that plugins can read/write.

## dependencies

the repo is split into two packages:

- **@tame/sdk** — interfaces, types, and utilities that plugins depend on. no heavy deps.
- **@tame/core** — the agent harness implementation, llm providers, rate limiters, and built-in plugins. depends on @tame/sdk.

shared deps managed via root `deno.json` imports:

| import | source | purpose |
|--------|--------|---------|
| `@std/path` | jsr | path manipulation |
| `typebox` | npm | runtime schema validation |

the acp plugin additionally pulls `@agentclientprotocol/sdk` from npm at runtime.

## code conventions

- private class fields use `#` prefix
- plugin ids are const-asserted string literals (`"foo" as const`)
- symbols for plugin data keys and message metadata
- `typebox` for all runtime type validation
- `structuredClone` when passing messages between contexts to avoid mutation
