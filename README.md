# tame

minimal harness for people who don't care to larp as terminal users

## features

- an agent loop
- plugin system
- multi-provider routing
- nothing else

## config

minimal `~/.tame/config.json`:

```json
{
    "providers": {
        "openrouter": {
            "type": "provider",
            "provider": "openrouter",
            "apiKey": "sk-or-v1-...",
            "model": "openai/gpt-oss-120b:free",
            "headers": {
                "X-Title": "Tame",
                "HTTP-Referer": "https://merkletr.ee/tame"
            },
            "limiter": { "type": "backoff-only" }
        }
    },
    "defaultProvider": "openrouter",
    "plugins": [
        "@tame/plugin-ops",
        "@tame/plugin-compact",
        "@tame/plugin-history",
        "@tame/plugin-rpc",
        "@tame/plugin-web"
    ]
}
```

see per-plugin READMEs for details.

see [CONTRIBUTING.md](CONTRIBUTING.md) for plugin config details and development setup.
