# tame/plugins/acp

Agent Client Protocol

session loading is supported if `history` is also loaded

## example acp.json

```json
{
    "listen": {
        "transport": "unix",
        "path": "/path/to/tame.sock"
    }
}
```

on the client side, set the command to e.g. `socat - /path/to/tame.sock` to connect.
