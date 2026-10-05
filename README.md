# opencode-plugin-dsml-fix

OpenCode V2 plugin that recovers DeepSeek DSML tool calls when the provider's
parser fails and raw markup leaks into assistant text as prose.

## The problem

On DeepSeek served through OpenCode (notably `opencode-go/deepseek-*`), tool
calls sometimes arrive as visible XML-ish markup in the assistant message
instead of executing — the agent stalls or pastes the markup back at you. It
happens most in long sessions, where the provider's parser degrades: the outer
block opener goes missing, invoke openers get mangled, and only the inner
parameter tags survive.

This plugin repairs those leaks client-side, in OpenCode, without waiting on
the provider. Normal responses pass through byte-identical.

## Install

```jsonc
// opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-plugin-dsml-fix"],
}
```

Requires OpenCode V2 (`2.0.x`). No other setup — defaults cover the
`opencode-go` and `opencode` (Zen) providers.

To confirm it's loaded, run any prompt and look for the probe log
(`debug: true`, see below).

## What it does

- **Streaming recovery.** Leaked DSML blocks in response text become real tool
  calls, so the agent loop dispatches the intended call instead of stalling.
  Covers both the native SSE path (what `opencode-go` uses) and the AI-SDK
  path (other providers).
- **History sanitization.** Strips leaked markup from replayed assistant
  messages so the model stops imitating its own degraded output. History is
  never turned into calls — no double execution.
- **Prevention.** A system directive states the exact required envelope, plus
  a conditional nudge when a turn ends with unrecovered markup.
- **Safety net.** An idle watchdog sends one short retry when a session stalls
  on unrecovered markup, capped per message.

Every layer is independently toggleable (see Configuration). If any layer
misfires, switch that one flag off — the plugin degrades to a safer subset
and never breaks normal inference.

## Verify it's working

Enable debug logging:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-plugin-dsml-fix",
      "options": { "debug": true },
    },
  ],
}
```

Each turn logs one request line and one line per response attempt,
identified as `sessionID/user-messageID` (`#n` counts retries in the turn):

```
[dsml] request ses_abc/msg_xyz sanitized=2msgs/3parts directive=yes nudge=no
[dsml] response ses_abc/msg_xyz#1 recovered=1
[dsml] response ses_abc/msg_xyz#2 passthrough
```

- `sanitized=Nmsgs/Mparts` — replayed history stripped (plus a short note).
- `recovered=N` — tool calls rescued from leaked markup. The fix fired.
- `passthrough` — no markup seen, bytes untouched.
- `held-candidate-no-call` — something looked like markup but parsed to
  nothing (emitted verbatim). Frequent sightings mean a new variant worth
  reporting — file an issue with the excerpt.

## Configuration

```jsonc
{
  "plugins": [
    {
      "package": "opencode-plugin-dsml-fix",
      "options": {
        "providers": ["opencode-go", "opencode"],
        "mode": "relaxed",
        "resume": { "enabled": true, "maxAttempts": 3 },
      },
    },
  ],
}
```

| Option | Default | Meaning |
|---|---|---|
| `providers` | `["opencode-go","opencode"]` | Provider IDs in scope. Empty disables the plugin. |
| `mode` | `"relaxed"` | `"relaxed"` = full variant catalogue; `"strict"` = complete blocks only. |
| `rescue.orphanInvoke` | mode | Invokes with no outer opener. |
| `rescue.looseParameters` | mode | Tolerant re-scan past broken closers. |
| `rescue.rawJsonBody` | mode | Bare-JSON invoke bodies. |
| `rescue.wrappedTool` | mode | Orphan `<parameter name="X">` with complete inner params. |
| `bufferLimit` | `65536` | Streaming hold cap in bytes. |
| `response.sse` | `true` | Native path: rewrite SSE bytes (`http.response`). |
| `response.aisdkStream` | `true` | AI-SDK path: streaming parts. |
| `response.aisdkGenerate` | `true` | AI-SDK path: non-streaming results. |
| `request.sanitize` | `true` | Strip leaked spans from replayed history. |
| `request.directive` | `true` | Preventive system directive. |
| `request.systemNudge` | `true` | Conditional correction when a turn ends unrecovered. |
| `resume.enabled` | `true` | Idle watchdog wake. |
| `resume.maxAttempts` | `3` | Cap per assistant message. |
| `resume.channel` | `"system"` | `"system"` = minimal ping + nudge; `"user"` = legacy full-text turn. |
| `debug` | `false` | Per-turn impact logging (see above). |

Older names (`recovery.*`, `strategies.*`, `resume.*`, `prompt.*`) still work
as aliases. Precedence: `response`/`request` > `recovery` > `strategies` >
legacy names > defaults.

## Development

```bash
bun install
bun test        # 115 tests: grammar, parser, stream, wrapper, config, sse, golden
bun run check   # typecheck + tests
```

- `docs/PATTERNS.md` — failure-shape catalogue (source of truth for recovery)
- `docs/TEST-MATRIX.md` — behaviour ↔ test map
- `test/golden/` — synthetic byte-faithful fixtures + generator
  (`build-fixtures.ts`); the repo never stores live markup tokens

## License

MIT — see [LICENSE](./LICENSE).
