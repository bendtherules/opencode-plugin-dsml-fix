/** The dependency-free language-model wrapper: stream + generate recovery. */

import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"
import { describe, expect, test } from "bun:test"
import { recoverGenerateResult, wrapDsmlLanguageModel } from "../src/middleware.ts"
import { block, invoke, param } from "./fixtures.ts"

function fakeModel(deltas: string[], finish: "stop" | "tool-calls" = "stop"): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "opencode-go",
    modelId: "deepseek-v4.1-flash",
    supportedUrls: {},
    async doGenerate() {
      return {
        content: [{ type: "text", text: deltas.join("") }],
        finishReason: { unified: finish, raw: finish },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      }
    },
    async doStream() {
      const parts = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        ...deltas.map((delta) => ({ type: "text-delta", id: "t1", delta })),
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: finish, raw: finish }, usage: {} },
      ]
      return {
        stream: new ReadableStream({
          start(c) {
            for (const p of parts) c.enqueue(p)
            c.close()
          },
        }),
      }
    },
  } as unknown as LanguageModelV3
}

const opts = {} as unknown as LanguageModelV3CallOptions

async function collect(stream: ReadableStream) {
  const out: Array<{ type: string; [k: string]: unknown }> = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out.push(value)
  }
  return out
}

describe("wrapDsmlLanguageModel", () => {
  test("stream recovers a call and flips finish", async () => {
    const wrapped = wrapDsmlLanguageModel(fakeModel([block([invoke("bash", [param("command", "pwd")])])]))
    const result = await wrapped.doStream(opts)
    const events = await collect(result.stream as ReadableStream)
    expect(events.some((e) => e.type === "tool-call")).toBe(true)
    const finish = events.find((e) => e.type === "finish") as unknown as { finishReason: { unified: string } }
    expect(finish.finishReason.unified).toBe("tool-calls")
  })

  test("plain text passes through untouched", async () => {
    const wrapped = wrapDsmlLanguageModel(fakeModel(["hello world"]))
    const result = await wrapped.doStream(opts)
    const events = await collect(result.stream as ReadableStream)
    expect(events.some((e) => e.type === "tool-call")).toBe(false)
    expect(events.filter((e) => e.type === "text-delta").map((e) => e.delta).join("")).toBe("hello world")
  })

  test("generate recovers a call", async () => {
    const wrapped = wrapDsmlLanguageModel(fakeModel(["lead ", block([invoke("q", [param("a", "1")])]), " tail"]))
    const result = await wrapped.doGenerate(opts)
    expect(result.content.some((p) => p.type === "tool-call")).toBe(true)
    expect(result.finishReason.unified).toBe("tool-calls")
  })

  test("delegates identity fields", () => {
    const wrapped = wrapDsmlLanguageModel(fakeModel([]))
    expect(wrapped.provider).toBe("opencode-go")
    expect(wrapped.modelId).toBe("deepseek-v4.1-flash")
    expect(wrapped.specificationVersion).toBe("v3")
  })
})

describe("recoverGenerateResult", () => {
  test("unparseable block returns input unchanged", () => {
    const content = [{ type: "text", text: "plain" }]
    const finishReason = { unified: "stop", raw: "stop" } as const
    const r = recoverGenerateResult(content as never, finishReason)
    expect(r.recovered).toBe(0)
    expect(r.finishReason.unified).toBe("stop")
  })
})
