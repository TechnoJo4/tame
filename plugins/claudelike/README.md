# claudelike

Tools following Claude Code conventions — naming, input schemas, and output formats.

## tools

| tool | claude code equivalent | notes |
|------|----------------------|-------|
| `Read` | `Read` | absolute `file_path`, cat -n line numbers, structured output |
| `Write` | `Write` | absolute `file_path`, reads-before-write expected |
| `Edit` | `Edit` | `old_string`/`new_string`/`replace_all` |
| `Bash` | `Bash` | string `command`, optional `timeout`/`description` |
| `Skill` | `Skill` | `skill` name + optional `args`, automatic $ARGUMENTS substitution |
| `Glob` | `Glob` | `pattern` + optional `path` |
| `Grep` | `Grep` | `pattern`, `path`, `glob`, `output_mode`, `head_limit`, `-i` |

## config

```json
{
  "maxLines": 2000,
  "maxBytes": 51200,
  "timeout": 120000,
  "shell": ["bash", "-lc"],
  "tools": {
    "read": true,
    "write": true,
    "edit": true,
    "bash": true,
    "glob": true,
    "grep": true,
    "skill": true
  }
}
```

## usage

Add `"claudelike"` to the `plugins` array in `~/.tame/config.json`, after `"ops"` and `"skills"`:

```json
{
  "plugins": ["ops", "skills", "claudelike"]
}
```

The ops plugin must be loaded first — claudelike reads the `Env` from ops.
The skills plugin should be loaded before claudelike — the `Skill` tool wraps the skills plugin's public API.

When using claudelike's `Skill` tool, disable the skills plugin's built-in tools and catalog to avoid duplicates:

```json
// ~/.tame/skills.json
{
  "addCatalog": false,
  "addTools": false
}
```

If you're using claudelike, you can disable overlapping tools in ops:

```json
// ~/.tame/ops.json
{
  "tools": {
    "read": false,
    "write": false,
    "edit": false,
    "exec": false
  }
}
```
