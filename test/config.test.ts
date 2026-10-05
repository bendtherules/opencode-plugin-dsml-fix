/** Config, mode gating, prompt guards, and fallback decisions. */

import { describe, expect, test } from "bun:test"
import { appliesToProvider, resolveConfig } from "../src/config.ts"
import { attemptKey, decideResume, messageText, needsSystemNudge, nudgeCapKey, parseAttempts, wakeText } from "../src/fallback.ts"
import { block, invoke, param } from "./fixtures.ts"
import { parseDsml, redactionNote, stripRangesWithNote } from "../src/parse.ts"
import { containsLiveMarker, preventiveDirective, recoveryNudge } from "../src/prompt.ts"

describe("config", () => {
  test("defaults target both Zen providers in relaxed mode", () => {
    const c = resolveConfig()
    expect([...c.providers]).toEqual(["opencode-go", "opencode"])
    expect(c.relaxed).toBe(true)
    expect(c.orphanInvoke).toBe(true)
    expect(c.watchdogEnabled).toBe(true)
    expect(c.resumeMaxAttempts).toBe(3)
    expect(c.directiveEnabled).toBe(true)
    expect(c.resumeChannel).toBe("system")
  })

  test("strict mode disables every rescue", () => {
    const c = resolveConfig({ mode: "strict" })
    expect(c.relaxed).toBe(false)
    expect(c.orphanInvoke).toBe(false)
    expect(c.looseParameters).toBe(false)
    expect(c.rawJsonBody).toBe(false)
  })

  test("one rescue can be switched off in isolation", () => {
    const c = resolveConfig({ rescue: { orphanInvoke: false } })
    expect(c.orphanInvoke).toBe(false)
    expect(c.looseParameters).toBe(true)
  })

  test("empty providers disables scoping", () => {
    const c = resolveConfig({ providers: [] })
    expect(appliesToProvider(c, "opencode-go")).toBe(false)
  })

  test("provider scoping", () => {
    const c = resolveConfig()
    expect(appliesToProvider(c, "opencode-go")).toBe(true)
    expect(appliesToProvider(c, "opencode")).toBe(true)
    expect(appliesToProvider(c, "anthropic")).toBe(false)
    expect(appliesToProvider(c, undefined)).toBe(false)
  })
})

describe("strategy matrix", () => {
  test("each transport recovers independently", () => {
    const off = resolveConfig({ recovery: { sse: false } })
    expect(off.sseEnabled).toBe(false)
    expect(off.generateEnabled).toBe(true)
    const all = resolveConfig({
      recovery: { sse: false, aisdkStream: false, aisdkGenerate: false },
      request: { sanitize: false, directive: false, systemNudge: false },
    })
    expect(all.streamEnabled).toBe(false)
    expect(all.generateEnabled).toBe(false)
    expect(all.sanitizeEnabled).toBe(false)
    expect(all.directiveEnabled).toBe(false)
    expect(all.systemNudgeEnabled).toBe(false)
  })

  test("recovery/request win over legacy strategies.*", () => {
    expect(resolveConfig({ strategies: { sse: false } }).sseEnabled).toBe(false)
    expect(
      resolveConfig({ strategies: { sse: false }, response: { sse: true } }).sseEnabled,
    ).toBe(true)
    expect(
      resolveConfig({ strategies: { sanitize: false }, request: { sanitize: true } }).sanitizeEnabled,
    ).toBe(true)
  })

  test("legacy aliases still work; new names win when set", () => {
    expect(resolveConfig({ resume: { enabled: false } }).watchdogEnabled).toBe(false)
    expect(resolveConfig({ prompt: { enabled: false } }).directiveEnabled).toBe(false)
    expect(resolveConfig({ resume: { enabled: false }, strategies: { watchdog: true } }).watchdogEnabled).toBe(true)
    expect(resolveConfig({ resume: { channel: "user" } }).resumeChannel).toBe("user")
  })
})

describe("strict mode parsing", () => {
  const strict = { orphanInvoke: false, looseParameters: false, rawJsonBody: false }

  test("complete block still parses", () => {
    const r = parseDsml(block([invoke("bash", [param("command", "pwd")])]), strict)
    expect(r.calls).toHaveLength(1)
  })

  test("orphan invoke is not recovered", () => {
    const r = parseDsml(invoke("edit", [param("path", "a")]), strict)
    expect(r.calls).toHaveLength(0)
  })

  test("mis-closed parameter is not rescued", () => {
    const a = `<\uFF5CDSML\uFF5Cparameter name="alpha" string="true">first</\uFF5CDSML\uFF5C>`
    const src = block([invoke("r", [a, param("beta", "second")])])
    const r = parseDsml(src, strict)
    // Strict keeps the strict scan as-is (runaway value), never the tolerant one.
    expect(r.calls.map((c) => c.name)).toEqual(["r"])
  })
})

describe("prompt", () => {
  test("directives contain no live marker", () => {
    expect(containsLiveMarker(preventiveDirective())).toBe(false)
    expect(containsLiveMarker(recoveryNudge("edit"))).toBe(false)
  })

  test("directive states the outer-layer rule", () => {
    expect(preventiveDirective()).toContain("outer block")
    expect(recoveryNudge()).toContain("outer")
  })
})

describe("fallback", () => {
  test("no marker → no nudge", () => {
    expect(decideResume("hello world", 0, 3)).toEqual({ send: false, reason: "no-marker" })
  })

  test("recoverable text → no nudge (middleware owns it)", () => {
    const decision = decideResume(block([invoke("bash", [param("command", "pwd")])]), 0, 3)
    expect(decision.send).toBe(false)
    expect(decision.reason).toBe("already-recoverable")
  })

  test("unrecoverable markup → nudge with correction text", () => {
    const decision = decideResume("broken \uFF5CDSML\uFF5C tool_calls garbage", 0, 3)
    expect(decision.send).toBe(true)
    expect(decision.text).toContain("outer")
  })

  test("cap is enforced", () => {
    const decision = decideResume("broken \uFF5CDSML\uFF5C tool_calls garbage", 3, 3)
    expect(decision).toEqual({ send: false, reason: "cap-reached" })
  })

  test("attempt key is namespaced per message", () => {
    expect(attemptKey("s1", "m1")).not.toBe(attemptKey("s1", "m2"))
  })

  test("parseAttempts tolerates garbage", () => {
    expect(parseAttempts(undefined)).toBe(0)
    expect(parseAttempts("x")).toBe(0)
    expect(parseAttempts(2)).toBe(2)
  })

  test("messageText reads assistant text only", () => {
    expect(messageText({ role: "user", content: [{ type: "text", text: "hi" }] })).toBeUndefined()
    expect(messageText({ role: "assistant", content: [{ type: "text", text: "a" }] })).toBe("a")
  })

  test("messageText tolerates null text", () => {
    expect(messageText({ role: "assistant", content: [{ type: "text", text: null }] })).toBeUndefined()
  })
})

describe("system nudge", () => {
  const unrecoverable = `trailing \uFF5CDSML\uFF5C tool_calls garbage without structure`

  test("fires when history ends in unrecoverable DSML", () => {
    const nudge = needsSystemNudge([{ role: "assistant", content: [{ type: "text", text: unrecoverable }] }])
    expect(nudge?.text).toContain("outer")
    expect(nudge?.key).toBeTruthy()
  })

  test("silent for clean history", () => {
    expect(needsSystemNudge([{ role: "assistant", content: [{ type: "text", text: "done" }] }])).toBeUndefined()
  })

  test("silent when the middleware could recover it", () => {
    const nudge = needsSystemNudge([
      { role: "assistant", content: [{ type: "text", text: block([invoke("bash", [param("command", "pwd")])]) }] },
    ])
    expect(nudge).toBeUndefined()
  })

  test("prefers message id, falls back to content hash", () => {
    expect(nudgeCapKey({ id: "msg-1", role: "assistant", content: [{ type: "text", text: "x" }] })).toBe("msg-1")
    const a = nudgeCapKey({ role: "assistant", content: [{ type: "text", text: "same" }] })
    const b = nudgeCapKey({ role: "assistant", content: [{ type: "text", text: "same" }] })
    const c = nudgeCapKey({ role: "assistant", content: [{ type: "text", text: "different" }] })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  test("wake text is minimal", () => {
    expect(wakeText().length).toBeLessThan(60)
  })

  test("turnId uses OpenCode's user message id", async () => {
    const { turnId } = await import("../src/fallback.ts")
    expect(
      turnId([
        { role: "user", content: [{ type: "text", text: "first" }], id: "msg-aaa" },
        { role: "assistant", content: [{ type: "text", text: "reply" }], id: "msg-bbb" },
        { role: "user", content: [{ type: "text", text: "second" }], id: "msg-ccc" },
      ]),
    ).toBe("msg-ccc")
    expect(turnId([])).toBe("no-user-turn")
    expect(
      turnId([{ role: "assistant", content: [{ type: "text", text: "x" }] }]),
    ).toBe("no-user-turn")
  })

  test("sseEnabled defaults true; response.sse wins", () => {
    expect(resolveConfig().sseEnabled).toBe(true)
    expect(resolveConfig({ response: { sse: false } }).sseEnabled).toBe(false)
    expect(resolveConfig({ recovery: { sse: false } }).sseEnabled).toBe(false)
    expect(
      resolveConfig({ recovery: { sse: false }, response: { sse: true } }).sseEnabled,
    ).toBe(true)
  })
})

describe("redaction note", () => {
  test("placeholder replaces each removed span", () => {
    expect(stripRangesWithNote("a <b>c", [{ start: 2, end: 7 }], "[removed malformed edit call]")).toBe(
      "a [removed malformed edit call]",
    )
    expect(stripRangesWithNote("a <b>c", [{ start: 2, end: 5 }])).toBe("a [malformed tool call removed]c")
  })

  test("note carries no marker bytes", () => {
    const out = stripRangesWithNote("x", [{ start: 0, end: 1 }], "[removed malformed edit call]")
    expect(containsLiveMarker(out)).toBe(false)
  })

  test("redactionNote names tools, caps length", () => {
    expect(redactionNote(["edit"])).toBe("[removed malformed edit call]")
    expect(redactionNote([])).toBe("[removed malformed markup]")
    expect(containsLiveMarker(redactionNote(["edit", "shell"]))).toBe(false)
  })
})
