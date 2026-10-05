/**
 * Build synthetic golden fixtures: same 9 structural shapes as the real failures,
 * with generic content. Run with `bun test/golden/build-fixtures.ts` and redirect
 * to `test/golden/db-messages.json`.
 *
 * Shapes covered: wrapped edit/shell with markerless outer (V26), marked outer,
 * spaced closers, multiline values, shell metachars, one native tool-calls case.
 * Real bytes are assembled at runtime (never stored literally).
 */
const BAR = String.fromCharCode(0xff5c)
const M = `${BAR}DSML${BAR}`

const param = (name: string, value: string, m = M, json = false) =>
  `<${m}parameter name="${name}" string="${json ? "false" : "true"}">${value}</${m}parameter>`

interface Golden {
  seq: number
  finish: string
  text: string
}

const messages: Golden[] = [
  {
    seq: 5177,
    finish: "stop",
    text:
      `Now collect the player state reactively and add the seek callback. Let me update the screen.\n\n` +
      `<analysis>\nCollect state in onCreate and pass it into the settings screen.\n</analysis>\n\n` +
      `<parameter name="edit">\n` +
      `${param("newString", "        // Mirror the player state into a snapshot the UI reads.\n        playerState.collect { state.value = it }")}\n` +
      `${param("oldString", "        playerState.collect { state.value = it }")}\n` +
      `${param("path", "/proj/app/src/main/java/com/example/app/MainScreen.kt")}\n` +
      `</${M} invoke>\n</${M} calls>`,
  },
  {
    seq: 5425,
    finish: "stop",
    text:
      `The renderer joins pieces when the text buffer grows. Let me find where that happens.\n\n` +
      `<analysis>\nFind the append call sites in the render loop.\n</analysis>\n\n` +
      `<parameter name="shell">\n` +
      `${param("command", "cd /proj/native\ngrep -n 'append' src/render.cpp | head -20")}\n` +
      `</${M} invoke>\n</${M} calls>`,
  },
  {
    seq: 5443,
    finish: "stop",
    text:
      `The join rule handles the boundary marker. Let me inspect the decoder.\n\n` +
      `<analysis>\nInspect how boundary markers turn into separators.\n</analysis>\n\n` +
      `<parameter name="shell">\n` +
      `${param("command", "cd /proj/native\ngrep -rn 'decode' src/*.cpp src/*.hpp | head\necho \"=== impl ===\"\ngrep -rn 'std::string decode' src/")}\n` +
      `</${M} invoke>\n</${M} calls>`,
  },
  {
    seq: 5608,
    finish: "tool-calls",
    text:
      `The worker pool defaults to 8 threads, which oversubscribes a phone. Let me expose a thread-count knob with a sensible default.\n\n` +
      `<analysis>\nAdd a small native setter and call it before first inference.\n</analysis>\n\n` +
      `<${M}parameter name="edit">\n` +
      `${param("newString", '#include "engine_capi.h"\n\nnamespace rt { void set_num_threads(int n); }')}\n` +
      `${param("oldString", '#include "engine_capi.h"')}\n` +
      `${param("path", "/proj/app/src/main/cpp/engine_jni.cpp")}\n` +
      `</${M}invoke>`,
  },
  {
    seq: 5624,
    finish: "stop",
    text:
      `Call the thread setter during preload, tuned to the fast cores.\n\n` +
      `<analysis>\nSet threads once before loading, capped to the big cluster.\n</analysis>\n\n` +
      `<parameter name="edit">\n` +
      `${param("newString", "        loading = true\n        val threads = (cores / 2).coerceIn(2, 6)\n        try { Native.setThreads(threads) } catch (_: Throwable) { }")}\n` +
      `${param("oldString", "        loading = true")}\n` +
      `${param("path", "/proj/app/src/main/java/com/example/app/engine/Model.kt")}\n` +
      `</${M} invoke>\n</${M} calls>`,
  },
  {
    seq: 5647,
    finish: "stop",
    text:
      `The declaration may have landed inside the wrong scope. Let me check its position.\n\n` +
      `<analysis>\nVerify the declaration sits at file scope, not inside a block.\n</analysis>\n\n` +
      `<parameter name="shell">\n` +
      `${param("command", "cd /proj/app/src/main/cpp\ngrep -n 'namespace rt' engine_jni.cpp | head")}\n` +
      `</${M} invoke>\n</${M} calls>`,
  },
  {
    seq: 5663,
    finish: "stop",
    text:
      `The declaration didn't apply. Let me add it right after the include.\n\n` +
      `<analysis>\nInsert after the capi include with a unique anchor.\n</analysis>\n\n` +
      `<parameter name="edit">\n` +
      `${param("newString", '#include "engine_capi.h"\n\nnamespace rt { void set_num_threads(int n); }')}\n` +
      `${param("oldString", '#include "engine_capi.h"')}\n` +
      `${param("path", "/proj/app/src/main/cpp/engine_jni.cpp")}\n` +
      `</${M} invoke>\n</${M} calls>`,
  },
  {
    seq: 5679,
    finish: "stop",
    text:
      `Odd scoping at the call site. Let me check line numbers around it.\n\n` +
      `<analysis>\nCheck declaration location versus call site ordering.\n</analysis>\n\n` +
      `<parameter name="shell">\n` +
      `${param("command", "cd /proj/app/src/main/cpp\ngrep -n 'set_num_threads' engine_jni.cpp")}\n` +
      `</${M} invoke>\n</${M} calls>`,
  },
  {
    seq: 5695,
    finish: "stop",
    text:
      `The declaration is still missing. Let me write it directly.\n\n` +
      `<analysis>\nInsert with a precise unique anchor this time.\n</analysis>\n\n` +
      `<parameter name="edit">\n` +
      `${param("newString", '#include "engine_capi.h"\n\nnamespace rt { void set_num_threads(int n); }')}\n` +
      `${param("oldString", '#include "engine_capi.h"')}\n` +
      `${param("path", "/proj/app/src/main/cpp/engine_jni.cpp")}\n` +
      `</${M} invoke>\n</${M} calls>`,
  },
]

// Doubled-bar shape (`<｜｜DSML｜｜…>`) is covered in test/stream.test.ts and
// test/parse.test.ts with runtime-built markers.

console.log(JSON.stringify(messages))
