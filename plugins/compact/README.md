# tame/plugins/compact

basic compaction

## example compact.json

```json
{
    "maxTokens": 178000,
    "estimation": {
        "encoding": "cl100k_base"
    },
    "keepTail": {
        "type": "messages",
        "messages": 5
    }
}
```
