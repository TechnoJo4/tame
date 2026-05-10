# tame

minimal harness for people who don't care to larp as terminal users

## features

- an agent loop
- plugin system
- multi-provider routing
- nothing else

## config

minimal config.json:

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
    "toolsets": [
        "tavily-search",
        "jina-fetch"
    ],
    "plugins": [
        "ops",
        "acp",
        "compact",
        "history",
        "memory"
    ]
}
```

one file per plugin, see plugin readmes.

## plugins

| plugin | description |
|--------|-------------|
| `ops` | file read/write/edit + shell execution |
| `acp` | [Agent Client Protocol](https://agentclientprotocol.com/) over tcp or unix socket |
| `assisted-by` | inject `Assisted-by:` git trailer |
| `commands` | slash commands |
| `compact` | context compaction |
| `history` | session persistence |
| `memory` | per-session memory |
| `skills` | [Agent Skills](https://agentskills.io) |
