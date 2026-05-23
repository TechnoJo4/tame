# subagents plugin

launches subagents — independent agent sessions that handle multi-step tasks and report back.

## tool: `subagent`

| parameter | type | description |
|-----------|------|-------------|
| `description` | string | short (3-5 word) summary of the task |
| `prompt` | string | full task brief with all needed context |
| `subagent_type` | string? | agent type to use (omit for general-purpose) |
| `run_in_background` | boolean? | run asynchronously (default false) |

### sync mode (default)

The tool blocks until the subagent finishes. Returns:

```json
{
  "status": "completed",
  "result": "...",
  "agentId": "...",
  "toolCalls": [
    { "name": "...", "result": "...", "error": false }
  ]
}
```

### async mode (`run_in_background: true`)

Returns immediately:

```json
{
  "status": "async_launched",
  "agentId": "...",
  "description": "...",
  "prompt": "..."
}
```

When the subagent finishes (or fails), a notification user message is injected into your conversation:

```
[Subagent "description" completed]

result text here...
```

Launch multiple background subagents in one message to run work in parallel.

## tool: `kill_subagent`

| parameter | type | description |
|-----------|------|-------------|
| `agentId` | string | agentId from async_launched response |

Aborts a running background subagent. A failure notification is injected into the parent.

## agent definitions

other plugins register agent types via `harness.getPlugin<SubagentsPlugin>("subagents")?.registerAgent(def)`:

```ts
import type { SubagentsPlugin, AgentDefinition } from "@tame/plugin-subagents/index";

const def: AgentDefinition = {
  type: "code-reviewer",
  whenToUse: "reviews code for bugs and style issues",
  systemPrompt: "you are a code reviewer...",
  tools: ["read", "exec"],  // optional allowlist
};

harness.getPlugin<SubagentsPlugin>("subagents")?.registerAgent(def);
```

## config

`~/.tame/subagents.json`:
```json
{
  "maxDepth": 1,
  "maxToolResultLength": 2000
}
```

- `maxDepth` (default 1): how deep subagents can nest. 0 = no subagents, 1 = one level, etc.
- `maxToolResultLength` (default 2000): truncate tool results in the output summary.
