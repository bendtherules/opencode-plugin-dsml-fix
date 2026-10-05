/**
 * Fixture builders for DSML parser tests.
 *
 * The live DSML marker contains U+FF5C (full-width vertical bar). We never write
 * that byte literally in this repository: models and greedy provider extractors
 * treat it as a tool-call start, and a literal token in a source file becomes a
 * phantom call. Everything is built from `BAR` at runtime instead.
 */

/** U+FF5C full-width vertical bar. */
export const BAR = String.fromCharCode(0xff5c)

/** ASCII pipe, the other bar the grammar accepts. */
export const PIPE = "|"

/** Canonical marker: `<｜DSML｜>`. */
export const marker = (bar = BAR, count = 1) => `${bar.repeat(count)}DSML${bar.repeat(count)}`

/** Mangled / doubled marker, as emitted by gateways that re-decode tokens. */
export const markerDoubled = () => marker(BAR, 2)
export const markerAscii = () => "|DSML|"

/** A DSML tag: `<MARKERname attrs...>`. */
export const tag = (name: string, attrs = "", m = marker()) => `<${m}${name}${attrs ? " " + attrs : ""}>`

/** A closing DSML tag. */
export const closeTag = (name: string, m = marker()) => `</${m}${name}>`

/** A parameter element. `string=false` encodes a JSON value. */
export const param = (name: string, value: string, opts: { json?: boolean; m?: string; quote?: string } = {}) => {
  const m = opts.m ?? marker()
  const q = opts.quote ?? '"'
  const stringAttr = opts.json ? ` string="false"` : ` string="true"`
  return `${tag("parameter", `name=${q}${name}${q}${stringAttr}`, m)}${value}${closeTag("parameter", m)}`
}

/** An invoke element wrapping zero or more parameters. */
export const invoke = (name: string, params: string[] = [], opts: { m?: string; quote?: string } = {}) => {
  const m = opts.m ?? marker()
  const q = opts.quote ?? '"'
  return `${tag("invoke", `name=${q}${name}${q}`, m)}${params.join("")}${closeTag("invoke", m)}`
}

/** A tool_calls block wrapping one or more invokes. */
export const block = (
  invokes: string[],
  opts: { m?: string; kind?: string } = {},
) => {
  const m = opts.m ?? marker()
  const kind = opts.kind ?? "tool_calls"
  return `${tag(kind, "", m)}${invokes.join("")}${closeTag(kind, m)}`
}

/** The end-of-sentence sentinel some backends emit. */
export const eos = (bar = BAR) => `<${bar.repeat(2)}end\u2581of\u2581sentence${bar.repeat(2)}>`

/** Concatenate fragments (makes intent explicit at call sites). */
export const text = (...parts: string[]) => parts.join("")
