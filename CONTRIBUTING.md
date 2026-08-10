# working on tame

this file is for your context if you're working on this repo (human or agent)

## core tenets

**slim core**: it's just a pure agent loop. no tools. no interface. bring your own I/O.

**isolation**: if you don't want a feature, disable the plugin and it doesn't exist anymore. no feature-flag-like dead code. each plugin has its own config file.

**make it your own**: you should be able to do practically anything with plugins. make tame what you want it to be!

## core architecture

- **harness** (`packages/core/agent/harness.ts`): singleton that holds tools + plugins, creates agents.
- **thread** (`packages/sdk/util/thread.ts`): abortable work queue. serializes async functions.
- **emitter** (`packages/sdk/util/emitter.ts`): thread-based event processor. event handlers (`T => Promise<T>`) can be added `before`, `after`, `once`. handlers modify event data. `fire` just adds to queue (non-blocking), `do` waits and returns the final modified event.
- **agent** (`packages/core/agent/agent.ts`): a single conversation session. owns the message context, an llm provider, tools, and plugin data. emitter with `userMessage`, `completion`, `assistantMessage`, `toolResult`, `idle` events.
- **plugin** (`packages/sdk/agent/plugin.ts`): `init(harness)` and `newAgent(agent)`. plugins register tools, add event handlers, and store data in `agent.pluginData`.
- **tool** (`packages/sdk/agent/tool.ts`): name, description, typebox args schema, exec function, optional view functions (for e.g. compaction, web rendering).
- **llm provider** (`packages/sdk/llm/types.ts`): `interface InferenceProvider { complete(req, signal?): Promise<AssistantMessage>; }`.

the agent event lifecycle:

```
userMessage → completion → assistantMessage → [toolResult → completion → assistantMessage → ...] → idle
```

## plugin architecture

each plugin directory contains:

- `index.ts` -- exports the plugin class and optionally its config schema (typebox). this is the plugin's public api; other plugins import types from here to interoperate.
- `main.ts` -- default-exported plugin instance, constructed with config. this is what the harness loads.
- `README.md` -- usage docs (optional but encouraged)

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

plugins that need config should export `configSchema` from `index.ts` and use `readTameConfig("filename.json", configSchema)` in `main.ts`. config files live in `~/.tame/`. plugins without config (like `plugin-history`) can just `new Plugin()` directly. there's no hot-reload -- restart to pick up changes.

### plugin data

`agent.pluginData` is a `Map<symbol, unknown>`. use a module-level `Symbol()` as the key. this is per-agent state that plugins can read/write.

## dependencies

the repo is split into several packages:

- **@tame/sdk** -- interfaces, types, and utilities that plugins depend on. no heavy deps.
- **@tame/core** -- the agent harness implementation, llm providers, rate limiters. depends on @tame/sdk.
- **@tame/rpc-client** -- browser rpc client (websocket transport). used by the web ui.
- **@tame/rpc-sdk** -- rpc type helpers (method descriptors, call wrappers). used by rpc-aware plugins.
- **@tame/web-sdk** -- web ui shared types (contexts, items, placement interface). used by web-aware plugins.

shared deps managed via root `deno.json` imports:

| import | source | purpose |
|--------|--------|---------|
| `@std/path` | jsr | path manipulation |
| `typebox` | npm | runtime schema validation |

the acp plugin additionally pulls `@agentclientprotocol/sdk` from npm at runtime.
