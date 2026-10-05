# opencode-plugin-dsml-fix

OpenCode V2 plugin that recovers DeepSeek DSML tool calls when the provider's
parser fails and the raw markup leaks into assistant text.

## What it does

1. **Streaming recovery (strategy B).** Wraps the provider language model via
   `ctx.aisdk.hook("language")`. Leaked DSML blocks in `text-delta` parts become
   real AI-SDK `tool-input-*` + `tool-call` parts, and `finishReason` flips from
   `stop` to `tool-calls` — so the agent loop dispatches the intended call instead
   of stalling. Reasoning and native tool parts pass through untouched.
2. **History sanitization.** Strips leaked DSML spans from replayed assistant text
   so the model stops imitating its own degraded output. Never synthesizes calls
   from history (no double execution).
3. **Correction directive.** A system instruction stating the exact required envelope
   (complete outer block layer, one invoke per call, parameters inside invokes).
4. **Auto-resume safety net (strategy A).** On session idle with unrecovered DSML
   markup, sends one short retry nudge, capped per message via plugin storage.

## Install

Add to `opencode.jsonc`:

```jsonc
{
  "plugins": ["/code/opencode-dsml-plugin"]
}
```

Or publish and reference the package name. Requires OpenCode V2 (`2.0.x`).

## Configuration

```jsonc
{
  "plugins": [
    {
      "package": "/code/opencode-dsml-plugin",
      "options": {
        "providers": ["opencode-go", "opencode"],
        "mode": "relaxed",
        "resume": { "enabled": true, "maxAttempts": 3 }
      }
    }
  ]
}
```

| Option | Default | Meaning |
|---|---|---|
| `providers` | `["opencode-go","opencode"]` | Provider IDs in scope. Empty disables the plugin. |
| `mode` | `"relaxed"` | `"relaxed"` = full catalogue; `"strict"` = complete blocks only. |
| `rescue.orphanInvoke` | mode | Recover invokes with no outer opener. |
| `rescue.looseParameters` | mode | Tolerant re-scan past broken closers. |
| `rescue.rawJsonBody` | mode | Bare-JSON invoke bodies. |
| `rescue.wrappedTool` | mode | Orphan `<parameter name="X">` with complete inner params. |
| `bufferLimit` | `65536` | Streaming hold cap in bytes. |
| `response.sse` | `true` | Native path: rewrite SSE bytes in `http.response`. |
| `response.aisdkStream` | `true` | AI-SDK path: wrap language model, streaming parts. |
| `response.aisdkGenerate` | `true` | AI-SDK path: wrap language model, generate results. |
| `request.sanitize` | `true` | Strip leaked spans from replayed history (+ one note). |
| `request.directive` | `true` | Preventive system directive (alias: `prompt.enabled`). |
| `request.systemNudge` | `true` | Conditional correction in system on unrecovered tail. |
| `resume.enabled` | `true` | Idle watchdog wake (alias: `strategies.watchdog`). |
| `resume.maxAttempts` | `3` | Cap per assistant message. |
| `resume.channel` | `"system"` | `"system"` = minimal ping + system nudge; `"user"` = legacy full-text synthetic turn. |
| `debug` | `false` | Log recoveries to stderr + probe file. |

`recovery.*` and `strategies.*` remain as deprecated aliases
(`sse`→`response.sse`, `stream`→`response.aisdkStream`,
`generate`→`response.aisdkGenerate`, `sanitize`/`directive`/`systemNudge`→`request.*`,
`watchdog`→`resume.enabled`). Precedence: `response`/`request` > `recovery` >
`strategies` > legacy `resume`/`prompt` > default.
If any layer misfires, switch that one flag off (or `mode: "strict"`) — the plugin
degrades to the safer subset and never breaks normal inference.

## Per-turn impact logging (`debug: true`)

Every request turn logs one line; every response stream logs one line on close.
Turns are identified as `sessionID/user-messageID` — OpenCode's own message
identity — with `#n` counting physical requests (retries) within the turn:

```
[dsml] request ses_abc/msg_xyz sanitized=2msgs/3parts directive=yes nudge=no
[dsml] response ses_abc/msg_xyz#1 recovered=1
[dsml] response ses_abc/msg_xyz#2 passthrough
[dsml] response ses_abc/msg_xyz#3 held-candidate-no-call
```

- `sanitized=Nmsgs/Mparts`: replayed history messages/parts stripped (+ note).
- `directive`/`nudge`: whether system text was added this turn.
- `recovered=N`: tool calls recovered from leaked markup this turn.
- `passthrough`: no DSML candidate ever seen — bytes untouched.
- `held-candidate-no-call`: something looked like markup but parsed to nothing
  (emitted verbatim). If you see this often, send the log excerpt — it's a new
  variant to catalogue.

## Development

```bash
bun install
bun test        # 111 tests across grammar/parser/stream/wrapper/config/sse
bun run check   # typecheck + tests (tsc --noEmit)
```

- `docs/PATTERNS.md` — variant catalogue (source of truth for every regex)
- `docs/TEST-MATRIX.md` — behaviour ↔ test map
- `docs/STATUS.md` — handoff / project status
- `test/fixtures.ts` — fixture builders (the repo never stores a live DSML token)
