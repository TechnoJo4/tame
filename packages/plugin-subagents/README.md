# subagents plugin

launches subagents — independent agent sessions that handle multi-step tasks and report back.

## tool: `subagent`

| parameter | type | description |
|-----------|------|-------------|
| `description` | string | short (3-5 word) summary of the task |
| `prompt` | string | full task brief with all needed context |
| `subagent_type` | string? | agent type to use (omit for general-purpose) |

returns:
```json
{
  "status": "completed" | "error",
  "result": "...",        // final assistant response
  "agentId": "...",       // subagent session id
  "toolCalls": [...]      // tools the subagent called
}
```

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
  "maxDepth": 1
}
```

- `maxDepth` (default 1): how deep subagents can nest. 0 = no subagents, 1 = one level, etc.
