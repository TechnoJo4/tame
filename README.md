# tame

minimal harness for people who don't care to larp as terminal users

## features

- an agent loop
- plugin system
- multi-provider routing
- nothing else

## packages

| package | description |
|---------|-------------|
| `@tame/sdk` | interfaces, types, utilities — what plugins depend on |
| `@tame/core` | agent harness, llm providers, rate limiters |
| `@tame/plugin-acp` | [Agent Client Protocol](https://agentclientprotocol.com/) over tcp or unix socket |
| `@tame/plugin-assisted-by` | inject `Assisted-by:` git trailer |
| `@tame/plugin-commands` | slash commands |
| `@tame/plugin-compact` | context compaction |
| `@tame/plugin-debug` | debug logging |
| `@tame/plugin-history` | session persistence |
| `@tame/plugin-jina-fetch` | web page fetching via Jina Reader |
| `@tame/plugin-memory` | per-session memory |
| `@tame/plugin-ops` | file read/write/edit + shell execution |
| `@tame/plugin-rpc` | json-based rpc |
| `@tame/plugin-rpc-ws` | websocket rpc transport |
| `@tame/plugin-skills` | [Agent Skills](https://agentskills.io) |
| `@tame/plugin-system-load` | prepend files to system prompt |
| `@tame/plugin-tavily-search` | web search via Tavily |

## config

minimal `~/.tame/config.json`:

```json
{
    "llm": {
        "type": "priority",
        "maxDelay": 10000,
        "providers": [
            {
                "type": "provider",
                "provider": "openrouter",
                "model": "qwen/qwen3.6-plus:free",
                "headers": {
                    "X-Title": "Tame",
                    "HTTP-Referer": "https://merkletr.ee/tame"
                },
                "limiter": { "type": "backoff-only", "minDelay": 500 }
            }
        ]
    },
    "plugins": [
        "@tame/plugin-ops",
        "@tame/plugin-acp",
        "@tame/plugin-compact",
        "@tame/plugin-history",
        "@tame/plugin-memory"
    ]
}
```

see [CONTRIBUTING.md](CONTRIBUTING.md) for plugin config details and development setup.
