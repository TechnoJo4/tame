# tame

minimal harness for people who don't care to larp as terminal users

features:
- an agent loop
- multi-provider routing
- nothing else

plugins:
- `acp`: [ACP](https://agentclientprotocol.com/) (over tcp/unix socket)
- `compact`: basic compaction
- `history`: save session history

config goes in `$TAME_DATA` or `~/.tame`:
- `system.txt`
- `config.json`
- one file per plugin

## example config.json

```json
{
    "llm": {
        "type": "priority",
        "maxDelay": 10000,
        "providers": [
            {
                "type": "provider",
                "provider": "opencode",
                "model": "qwen3.6-plus-free",
                "limiter": { "type": "backoff", "minDelay": 500 }
            },
            {
                "type": "provider",
                "provider": "openrouter",
                "model": "qwen/qwen3.6-plus:free",
                "headers": {
                    "X-Title": "Tame",
                    "HTTP-Referer": "https://merkletr.ee/tame"
                },
                "limiter": { "type": "backoff", "minDelay": 500 }
            }
        ]
    },
    "toolsets": [
        "simple-exec"
    ],
    "plugins": [
        "acp",
        "compact"
    ]
}
```
