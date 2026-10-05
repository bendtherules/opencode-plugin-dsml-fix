/**
 * Plugin configuration. Every behaviour the plugin adds can be narrowed back to a
 * simpler version without uninstalling: if the deeper fix misbehaves, turn its flag
 * off and the plugin degrades to the safer subset. The invariant is that the plugin
 * must never break normal inference — when in doubt it passes traffic through.
 */

export interface DsmlPluginOptions {
  /**
   * Provider IDs this plugin applies to. Defaults to the two Zen endpoints where
   * the DSML leak was observed. An empty list disables the plugin entirely.
   */
  providers?: string[]
  /**
   * Parsing strictness.
   * - `"relaxed"` (default): full catalogue — complete blocks, doubled bars,
   *   truncated tags, orphan-invoke rescue, mis-closed fallback, raw-JSON body.
   * - `"strict"`: complete `tool_calls`/`function_calls` blocks with proper closers
   *   only. Use when the deeper rescue ever misfires.
   */
  mode?: "strict" | "relaxed"
  /**
   * Granular rescue toggles. Each defaults to the `mode` value; setting one
   * explicitly overrides the mode for that area so a single failing rescue can be
   * switched off in isolation.
   */
  rescue?: {
    /** Recover `invoke` blocks with no outer opener (V9). Default: mode. */
    orphanInvoke?: boolean
    /** Tolerant re-scan when a value ran past a broken closer (V11). Default: mode. */
    looseParameters?: boolean
    /** Bare-`{…}` invoke body parsed as JSON (V25). Default: mode. */
    rawJsonBody?: boolean
    /** Wrapped tool: orphan `<parameter name="X">` with complete inner params (V26). Default: mode. */
    wrappedTool?: boolean
  }
  /** Streaming swallow cap in bytes (V15/buffer-cap). Default 65536. */
  bufferLimit?: number
  /**
   * Response-side recovery: turn leaked markup into real tool calls.
   * The two transports are independent paths to the model and are named as such.
   * (`recovery` is accepted as a deprecated alias; `response` wins when set.)
   */
  response?: {
    /** Native path: rewrite SSE bytes in `http.response` (opencode-go). Default true. */
    sse?: boolean
    /** AI-SDK path: wrap the language model, streaming parts. Default true. */
    aisdkStream?: boolean
    /** AI-SDK path: wrap the language model, non-streaming results. Default true. */
    aisdkGenerate?: boolean
  }
  /**
   * Deprecated alias for `response`. When both forms are set, `response` wins.
   */
  recovery?: {
    /** Alias: response.sse. */
    sse?: boolean
    /** Alias: response.aisdkStream. */
    aisdkStream?: boolean
    /** Alias: response.aisdkGenerate. */
    aisdkGenerate?: boolean
  }
  /**
   * Request-side shaping: control what the model sees in history and system.
   */
  request?: {
    /** Strip leaked DSML spans from replayed assistant history. Default true. */
    sanitize?: boolean
    /** Preventive system directive on every request. Default true. */
    directive?: boolean
    /** Conditional correction nudge in system when history ends in unrecovered DSML. Default true. */
    systemNudge?: boolean
  }
  /**
   * Per-strategy switches (deprecated alias for `recovery` + `request`; kept for
   * backward compatibility). When both forms are set, `recovery`/`request` win.
   */
  strategies?: {
    /** Alias: recovery.aisdkStream. */
    stream?: boolean
    /** Alias: recovery.aisdkGenerate. */
    generate?: boolean
    /** Alias: recovery.sse. */
    sse?: boolean
    /** Alias: request.sanitize. */
    sanitize?: boolean
    /** Alias: request.directive. */
    directive?: boolean
    /** Alias: request.systemNudge. */
    systemNudge?: boolean
    /** Alias: watchdog.enabled. */
    watchdog?: boolean
  }
  /** Strategy-A auto-resume safety net (idle watchdog). */
  resume?: {
    /**
     * Master switch (aliases: strategies.watchdog). Default true.
     * Precedence: strategies.watchdog > resume.enabled > default.
     */
    enabled?: boolean
    /** Max nudges per assistant message. Default 3. */
    maxAttempts?: number
    /**
     * Delivery channel for the watchdog wake.
     * - `"system"` (default): the wake is a minimal synthetic ping; the full
     *   correction rides as a transient system instruction via the context hook.
     * - `"user"`: legacy single-message correction nudge as a synthetic user turn.
     */
    channel?: "system" | "user"
  }
  /** Preventive system instruction (alias: request.directive). Default true. */
  prompt?: {
    /**
     * Master switch. Default true.
     * Precedence: request.directive > strategies.directive > prompt.enabled > default.
     */
    enabled?: boolean
  }
  /** Log recoveries to stderr. Default false. */
  debug?: boolean
}

export interface ResolvedDsmlConfig {
  readonly providers: readonly string[]
  readonly relaxed: boolean
  readonly orphanInvoke: boolean
  readonly looseParameters: boolean
  readonly rawJsonBody: boolean
  readonly wrappedTool: boolean
  readonly bufferLimit: number
  readonly streamEnabled: boolean
  readonly generateEnabled: boolean
  readonly sseEnabled: boolean
  readonly sanitizeEnabled: boolean
  readonly directiveEnabled: boolean
  readonly systemNudgeEnabled: boolean
  readonly watchdogEnabled: boolean
  readonly resumeMaxAttempts: number
  readonly resumeChannel: "system" | "user"
  readonly debug: boolean
}

const DEFAULT_PROVIDERS = ["opencode-go", "opencode"] as const

export function resolveConfig(input: DsmlPluginOptions = {}): ResolvedDsmlConfig {
  const relaxed = (input.mode ?? "relaxed") === "relaxed"
  const s = input.strategies ?? {}
  const response = input.response ?? {}
  const recovery = input.recovery ?? {}
  const request = input.request ?? {}
  return {
    providers: input.providers ?? [...DEFAULT_PROVIDERS],
    relaxed,
    orphanInvoke: input.rescue?.orphanInvoke ?? relaxed,
    looseParameters: input.rescue?.looseParameters ?? relaxed,
    rawJsonBody: input.rescue?.rawJsonBody ?? relaxed,
    wrappedTool: input.rescue?.wrappedTool ?? relaxed,
    bufferLimit: input.bufferLimit ?? 64 * 1024,
    streamEnabled: response.aisdkStream ?? recovery.aisdkStream ?? s.stream ?? true,
    generateEnabled: response.aisdkGenerate ?? recovery.aisdkGenerate ?? s.generate ?? true,
    sseEnabled: response.sse ?? recovery.sse ?? s.sse ?? true,
    sanitizeEnabled: request.sanitize ?? s.sanitize ?? true,
    directiveEnabled: request.directive ?? s.directive ?? input.prompt?.enabled ?? true,
    systemNudgeEnabled: request.systemNudge ?? s.systemNudge ?? true,
    watchdogEnabled: s.watchdog ?? input.resume?.enabled ?? true,
    resumeMaxAttempts: input.resume?.maxAttempts ?? 3,
    resumeChannel: input.resume?.channel ?? "system",
    debug: input.debug ?? false,
  }
}

/** Whether this model/provider pair is in scope. Matches provider ID exactly. */
export function appliesToProvider(config: ResolvedDsmlConfig, providerID: string | undefined): boolean {
  if (!providerID) return false
  return config.providers.includes(providerID)
}
