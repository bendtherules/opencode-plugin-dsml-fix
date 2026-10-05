/**
 * Recovery-failure nudge: the text the plugin shows the model so it re-issues a
 * tool call that arrived malformed.
 *
 * Writing rule: this string is *sent to the model*, so it describes the grammar
 * without containing a live DSML token. A literal token here would be parsed as a
 * phantom call by greedy provider extractors. The fixer tests assert the string
 * contains no marker bytes.
 */

/**
 * Recovery-failure nudge, sent when DSML markup appeared but no call
 * could be recovered, or when a session idles on leaked markup. Short, imperative,
 * and self-contained: it restates the required outer layer.
 */
export function recoveryNudge(toolHint?: string): string {
  const target = toolHint ? ` (${toolHint})` : ""
  return [
    `Your last tool call${target} arrived malformed and was not executed.`,
    "Re-issue it exactly once, using the correct format: a complete outer",
    "tool_calls block layer wrapping one invoke element per call, with each",
    "parameter element inside its invoke element. Do not emit bare parameter",
    "elements and do not omit the outer block layer.",
  ].join(" ")
}

/** Guard used by tests: model-facing text must contain no live marker. */
export function containsLiveMarker(text: string): boolean {
  return /[\uFF5C|]\s*DSML\s*[\uFF5C|]/i.test(text)
}
