# tame/plugins/acp

Agent Client Protocol

## example acp.json

```json
{
    "listen": {
        "transport": "tcp",
        "hostname": "0.0.0.0",
        "port": 1234
    }
}
```

on the client side, set the command to e.g. `nc 127.0.0.1 1234` to connect.
