# claudelike

Tools following Claude Code conventions — naming, input schemas, and output formats.

## tools

| tool | claude code equivalent | notes |
|------|----------------------|-------|
| `Read` | `Read` | absolute `file_path`, cat -n line numbers, structured output |
| `Write` | `Write` | absolute `file_path`, reads-before-write expected |
| `Edit` | `Edit` | `old_string`/`new_string`/`replace_all` |
| `Bash` | `Bash` | string `command`, optional `timeout`/`description` |
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
    "grep": true
  }
}
```

## usage

Add `"claudelike"` to the `plugins` array in `~/.tame/config.json`, after `"ops"`:

```json
{
  "plugins": ["ops", "claudelike"]
}
```

The ops plugin must be loaded first — claudelike reads the `Env` from ops.

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
