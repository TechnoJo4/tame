# skills

Agent Skills integration for tame. Implements the [Agent Skills specification](https://agentskills.io).

## config

`~/.tame/skills.json`:

```json
{
    "paths": [
        "./.agents/skills",
        "./.tame/skills",
        "~/.agents/skills",
        "~/.tame/skills"
    ],
    "maxDepth": 4,
    "excludeDirs": [".git", "node_modules", ".venv", "__pycache__"]
}
```

## how it works

- **discovery**: scans configured paths for `SKILL.md` files at startup
- **catalog**: injects a compact catalog (name + description) into context as the first user message
- **activation**: model calls `activate_skill` to load full instructions; user can use `/skill <name>`
- **protection**: skill content is marked `noCompact` so compaction preserves it
- **deactivation**: model calls `deactivate_skill` to release the protection, allowing cleanup
