/**
 * Correction directives: the text the plugin shows the model so it emits tool calls
 * in the correct format with the outer XML layer.
 *
 * Writing rule: these strings are *sent to the model*, so they describe the grammar
 * without containing a live DSML token. A literal token here would be parsed as a
 * phantom call by greedy provider extractors. The fixer tests assert the strings
 * contain no marker bytes.
 */

export const MARKER_DESCRIPTION =
  "a DeepSeek DSML tag uses single full-width bars around the word DSML " +
  "(open angle bracket, U+FF5C, the letters DSML, U+FF5C, then the tag name)"

/**
 * Preventive instruction, installed via the `context` hook as a system part. Tells
 * the model the exact envelope so degraded forms are less likely in the first place.
 */
export function preventiveDirective(): string {
  return [
    "Tool-call format (must follow exactly):",
    "1. Wrap every tool call in a complete outer block layer: an opening block tag",
    "   for tool_calls, then one invoke element per call, then the closing block tag.",
    `2. Each tag is ${MARKER_DESCRIPTION}. Never use doubled bars, never use plain ASCII pipes, never leave a space where the tag name belongs.`,
    "3. Each invoke element carries the tool name in its name attribute and contains",
    '   one parameter element per argument, with string="true" for plain text values',
    '   and string="false" for JSON values.',
    "4. Never emit a parameter element without its enclosing invoke element, and never",
    "   emit an invoke element without the outer block layer. Incomplete markup will",
    "   not be executed.",
  ].join("\n")
}

/**
 * Recovery-failure nudge, sent (via Strategy A) when DSML markup appeared but no call
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

/** Guard used by tests: neither directive may contain a live marker. */
export function containsLiveMarker(text: string): boolean {
  return /[\uFF5C|]\s*DSML\s*[\uFF5C|]/i.test(text)
}
