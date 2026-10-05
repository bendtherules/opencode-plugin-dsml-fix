/**
 * Strategy A: auto-resume safety net for turns the streaming middleware could not
 * recover. Pure decision logic lives here so it is unit-testable; OpenCode I/O
 * (events, session reads, synthetic prompts, storage) is injected by `src/index.ts`.
 *
 * Policy: when a session goes idle and its latest assistant text ends in DSML markup
 * that never became a tool call, send one short correction nudge (see
 * `src/prompt.ts`). Attempts are capped per message so a pathological loop cannot
 * run away.
 */

import { looksLikeDsml } from "./grammar.ts"
import { parseDsml, type ParseOptions } from "./parse.ts"
import { recoveryNudge } from "./prompt.ts"

export interface FallbackDecision {
  /** Whether to send the nudge. */
  readonly send: boolean
  /** The nudge text, present when `send` is true. */
  readonly text?: string
  /** Storage key the attempt was (or would be) counted under. */
  readonly key?: string
  /** Why no nudge is sent. */
  readonly reason?: string
}

/** Storage key for the attempt counter of one assistant message. */
export function attemptKey(sessionID: string, messageID: string): string {
  return `dsml/resume/${sessionID}/${messageID}`
}

/**
 * Minimal wake ping for the `"system"` resume channel. The substantive correction
 * rides as a transient system instruction (see `needsSystemNudge`); this message
 * only exists to wake the session so a new turn happens. Kept short and factual
 * so the user-channel transcript stays clean.
 */
export function wakeText(): string {
  return "Resume the interrupted tool call."
}

export interface HookMessage {
  readonly id?: string
  readonly role?: string
  readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: unknown }>
}

export interface SystemNudge {
  /** Cap key: message id when present, otherwise a hash of the text. */
  readonly key: string
  /** The correction text for the system channel. */
  readonly text: string
}

/** Stable cap key for a hook message: id when present, content hash otherwise. */
export function nudgeCapKey(message: HookMessage): string {
  if (message.id) return message.id
  return contentHash(message)
}

function contentHash(message: HookMessage): string {
  let hash = 0
  for (const part of message.content ?? []) {
    const text = part.type === "text" && typeof part.text === "string" ? part.text : ""
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0
  }
  return `hash-${(hash >>> 0).toString(36)}`
}

/**
 * Identify the current user turn from assembled history: the id of the last
 * user-role message, falling back to a content hash when ids are absent. This
 * is OpenCode's own message identity (`SessionMessage.ID`), so turns line up
 * with what the transcript, inbox, and logs already use. Retries within one
 * turn share the turn id — attempts are counted separately by the caller.
 */
export function turnId(messages: ReadonlyArray<HookMessage>): string {
  const last = [...messages].reverse().find((message) => message.role === "user")
  if (!last) return "no-user-turn"
  return last.id ?? contentHash(last)
}

/**
 * Decide whether the assembled request history ends in unrecovered DSML and needs
 * the correction as a transient system instruction. Pure: the caller enforces the
 * per-key cap via storage. Returns undefined when no nudge is warranted.
 */
export function needsSystemNudge(
  messages: ReadonlyArray<HookMessage>,
  parseOptions?: ParseOptions,
): SystemNudge | undefined {
  const last = [...messages].reverse().find((message) => message.role === "assistant")
  if (!last) return undefined
  const text = messageText({ role: last.role, content: last.content })
  if (!text || !looksLikeDsml(text)) return undefined
  const { calls } = parseDsml(text, parseOptions)
  if (calls.length > 0) return undefined
  return { key: nudgeCapKey(last), text: recoveryNudge() }
}

/**
 * Decide whether the latest assistant text warrants a correction nudge.
 *
 * @param text the latest assistant text (already stripped of nothing)
 * @param attempts nudges already sent for this message
 * @param maxAttempts cap from config
 */
export function decideResume(text: string, attempts: number, maxAttempts: number): FallbackDecision {
  if (!looksLikeDsml(text)) return { send: false, reason: "no-marker" }
  const { calls } = parseDsml(text)
  if (calls.length > 0) return { send: false, reason: "already-recoverable" }
  if (attempts >= maxAttempts) return { send: false, reason: "cap-reached" }
  return { send: true, text: recoveryNudge() }
}

/** Extract readable text from an OpenCode session-context message. */
export function messageText(message: {
  readonly role?: string
  readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: unknown }>
}): string | undefined {
  if (message.role && message.role !== "assistant") return undefined
  const parts = (message.content ?? []).filter((part) => part.type === "text" && typeof part.text === "string")
  if (parts.length === 0) return undefined
  return parts.map((part) => part.text as string).join("\n")
}

/** Parse an attempt counter value read from storage. */
export function parseAttempts(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value)
  return 0
}
