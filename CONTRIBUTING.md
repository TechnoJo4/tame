# working on tame

this file is for your context if you're working on this repo (human or agent)

## what is tame?

tame is a minimal ai agent harness written in typescript targeting the deno runtime.

core concepts:

- **harness** (`agent/harness.ts`): singleton that holds tools + plugins, creates agents. one harness per process.
- **thread** (`util/thread.ts`): abortable work queue. serializes async functions.
- **emitter** (`util/emitter.ts`): thread-based event queue. event handler (`T => Promise<T>`) can be added `before`, `after`, `once`. handlers modify event data. `fire` just adds to queue (non-blocking), `do` waits and returns the final modified event.
- **agent** (`agent/agent.ts`): a single conversation session. owns the message context, an llm provider, tools, and plugin data. extends emitter, events: `userMessage`, `completion`, `assistantMessage`, `toolResult`, `idle`.
- **plugin** (`agent/plugin.ts`): hooks into `init(harness)` and `newAgent(agent)`. plugins register tools, add event handlers, and store data in `agent.pluginData`.
- **tool** (`agent/tool.ts`): name, description, typebox args schema, exec function, optional view functions (for e.g. compaction, acp rendering).
- **llm provider** (`llm/types.ts`): implements `complete(req, signal?) -> AssistantMessage`. wrapped with rate limiters and request data injectors.
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
├── index.ts              # entry point
├── deno.json             # imports, lint rules, fmt settings
├── agent/                # agent, harness, plugin/tool interfaces
├── config/               # config loading & llm provider parsing
├── llm/                  # inference provider implementations
├── ratelimit/            # rate limiter implementations
├── plugins/              # one directory per plugin
│   ├── acp/              # agent client protocol
│   ├── assisted-by/      # git assisted-by trailer
│   ├── commands/         # slash command registry
│   ├── compact/          # context compaction
│   ├── debug/            # debug logging
│   ├── history/          # session persistence
│   ├── memory/           # remember/forget tools
│   ├── ops/              # file & shell operations
│   └── skills/           # agent skills
├── toolsets/             # standalone tool collections
│   ├── jina-fetch/       # web page fetching
│   └── tavily-search/    # web search
└── util/                 # emitter, thread, validation, symbols
```

## plugin architecture

each plugin directory contains:

- `index.ts` — exports the plugin class and optionally its config schema (typebox). this is the plugin's public api; other plugins import from here to interoperate.
- `main.ts` — default-exported plugin instance, constructed with config. this is what the harness loads.
- `README.md` — usage docs (optional but encouraged)

plugins communicate via `harness.getPlugin<T>(id)` or `harness.getPluginByType(Class)`. this is the intended interop mechanism. plugins should not import each other's internals directly unless they own the dependency (e.g., `ops` owns the `Env` interface; `acp` owns `ACPAdapter`).

### how to write a plugin

1. create `plugins/<name>/index.ts`:

```ts
import { Plugin } from "../../agent/plugin.ts";
import { Harness } from "../../agent/harness.ts";
import { Agent } from "../../agent/agent.ts";
import { tool, Type } from "../../agent/tool.ts";

export class MyPlugin implements Plugin {
    id = "my-plugin" as const;

    async init(harness: Harness) {
        // register tools, hook into other plugins
        harness.addTools(myTool);
    }

    newAgent(agent: Agent) {
        // per-agent setup: add event handlers, init pluginData
        agent.pluginData.set(someKey, {});
    }
}
```

2. create `plugins/<name>/main.ts`:

```ts
import { readTameConfig } from "../../config/index.ts";
import { configSchema, MyPlugin } from "./index.ts";

export default new MyPlugin(readTameConfig("my-plugin.json", configSchema));
```

3. add `"my-plugin"` to `plugins` in `config.json`.

### plugin config

use typebox for config schemas. plugins that need config should export `configSchema` from `index.ts` and use `readTameConfig("filename.json", configSchema)` in `main.ts`. config files live in `~/.tame/`. there's no hot-reload — restart to pick up changes.

### plugin data

`agent.pluginData` is a `Map<symbol, unknown>`. use a module-level `Symbol()` as the key. this is per-agent state that plugins can read/write.

## dependencies

managed via `deno.json` imports:

| import | source | purpose |
|--------|--------|---------|
| `@std/path` | jsr | path manipulation |
| `tiktoken` | npm | token counting for compaction |
| `typebox` | npm | runtime schema validation |

the acp plugin additionally pulls `@agentclientprotocol/sdk` from npm at runtime.

## code conventions

- private class fields use `#` prefix
- plugin ids are const-asserted string literals (`"foo" as const`)
- symbols for plugin data keys and message metadata
- `typebox` for all runtime type validation
- `structuredClone` when passing messages between contexts to avoid mutation
