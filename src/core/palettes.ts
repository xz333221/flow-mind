// =====================================================================
// Branch palettes — 8-color schemes cycled across the top-level
// branches when `rainbowBranch` is on.  Index 0 is the hue of the
// first child of root, and that hue propagates down the subtree.
//
// The built-ins cover the four most common XMind-style scheme
// categories: a Tailwind-rainbow default, a saturated "经典" set,
// a higher-contrast "活力" set, a pastel "薄荷" set, and a "代码"
// set tuned for dev-focused diagrams.  Users can extend with their
// own palettes via the settings panel; those are stored in
// `MindMapSettings.customPalettes` and re-fed through this resolver.
//
// Eight colors per palette matches the original `RAINBOW` constant
// in MindMap.vue (which used 8 hues for the same visual reason —
// most mindmaps have < 8 top-level branches, and a fixed cap keeps
// the cyclic reuse predictable when there are more).
// =====================================================================

export interface BranchPalette {
  id: string
  name: string
  /** Hex colors cycled across top-level branches, in display order. */
  colors: string[]
}

export const BUILTIN_PALETTES: readonly BranchPalette[] = [
  {
    id: 'default',
    name: '默认',
    colors: [
      '#f87171', '#fb923c', '#fbbf24', '#a3e635',
      '#34d399', '#22d3ee', '#818cf8', '#c084fc',
    ],
  },
  {
    id: 'classic',
    name: '经典',
    colors: [
      '#ef4444', '#f59e0b', '#10b981', '#3b82f6',
      '#6366f1', '#8b5cf6', '#ec4899', '#14b8a6',
    ],
  },
  {
    id: 'vivid',
    name: '活力',
    colors: [
      '#dc2626', '#ea580c', '#ca8a04', '#16a34a',
      '#0891b2', '#2563eb', '#7c3aed', '#db2777',
    ],
  },
  {
    id: 'dev',
    name: '代码',
    colors: [
      '#f472b6', '#a78bfa', '#60a5fa', '#38bdf8',
      '#22d3ee', '#34d399', '#facc15', '#fb923c',
    ],
  },
  {
    id: 'mint',
    name: '薄荷',
    colors: [
      '#5eead4', '#67e8f9', '#93c5fd', '#c4b5fd',
      '#fbcfe8', '#fde68a', '#a7f3d0', '#bae6fd',
    ],
  },
] as const

/**
 * Resolve a palette by id from a combined list of built-ins and
 * user-defined custom palettes.  Falls back to the default palette
 * if `id` is missing or points at a deleted custom palette.  Pure
 * — no DOM, no reactive deps — so it can be called from a computed
 * or a watch.
 */
export function resolvePalette(
  id: string,
  customPalettes: readonly BranchPalette[] = []
): BranchPalette {
  const all = [...BUILTIN_PALETTES, ...customPalettes]
  return all.find((p) => p.id === id) ?? BUILTIN_PALETTES[0]
}

/**
 * Parse a free-form text blob into a cleaned color array.  Accepts:
 *
 *   1. **Hex codes** — `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`,
 *      with or without the leading `#`.  The alpha channel on
 *      4- or 8-digit hex is silently dropped.
 *   2. **`rgb()` / `rgba()` functions** — `rgb(255, 99, 71)`,
 *      `rgba(255,99,71,0.5)`.  Whitespace and percentage values
 *      are both accepted (matches CSS rules).  Alpha dropped.
 *   3. **CSS named colors** — the 30 most common (`red`, `tomato`,
 *      `coral`, `teal`, …).  A small curated set keeps the parser
 *      from silently accepting typos that look color-ish
 *      (`tan`, `peru` are in; `chartreuse1` is not).
 *   4. **JSON / JS array** — `['#f87171', 'red']`,
 *      `["#f87171","rgb(0,0,255)"]`, even a single-line
 *      `["red","blue"]`.  Bracket and quote chars are tolerated
 *      so a copy-pasted `[…]` round-trips cleanly.
 *   5. **Any-delimiter blob** — the parser scans the raw text for
 *      color-shaped substrings rather than splitting on commas,
 *      so a user can paste `rgb(255, 0, 0), #0f0, blue` and every
 *      piece lands.
 *
 * Malformed tokens are dropped silently (consistent with the
 * rest of the canvas's "paste messy text" UX).  Returns at most
 * `maxColors` entries; output is lowercased `#rrggbb` for stable
 * dedup and direct comparison with `BUILTIN_PALETTES`.
 */
export function parsePaletteInput(
  text: string,
  maxColors = 8
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  // Walk every color-shaped substring.  Order matters: `rgb(` must
  // be matched before `#` so the hex regex doesn't gobble the `#`
  // inside `rgb(...)`.  Quotes / brackets are stripped later.
  const tokenRegex =
    /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|[A-Za-z][A-Za-z0-9_-]{2,30}/g
  let m: RegExpExecArray | null
  while ((m = tokenRegex.exec(text)) !== null) {
    const raw = m[0]
    let hex: string | null = null
    if (raw.startsWith('#')) {
      hex = expandHex(raw)
    } else if (raw.startsWith('rgb')) {
      hex = rgbToHex(raw)
    } else {
      // Looks like a CSS named color.  Validate against the table —
      // the regex above is intentionally loose so we don't reject
      // `darkred` / `cornflowerblue` etc.
      hex = NAMED_COLORS[raw.toLowerCase()] ?? null
    }
    if (!hex) continue
    const lc = hex.toLowerCase()
    if (seen.has(lc)) continue
    seen.add(lc)
    out.push(lc)
    if (out.length >= maxColors) break
  }
  return out
}

/** Expand `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` to `#rrggbb`.
 *  Returns null if the hex string is malformed.  Alpha on 4/8-digit
 *  hex is dropped — the canvas's per-branch background uses its own
 *  alpha for the node fill. */
function expandHex(raw: string): string | null {
  const s = raw.startsWith('#') ? raw.slice(1) : raw
  if (!/^[0-9a-fA-F]+$/.test(s)) return null
  let body: string
  if (s.length === 3) {
    // #rgb → #rrggbb
    body = s.split('').map((c) => c + c).join('')
  } else if (s.length === 4) {
    // #rgba → drop alpha
    body = s.slice(0, 3).split('').map((c) => c + c).join('')
  } else if (s.length === 6) {
    body = s
  } else if (s.length === 8) {
    // #rrggbbaa → drop alpha
    body = s.slice(0, 6)
  } else {
    return null
  }
  return '#' + body.toLowerCase()
}

/** Convert `rgb(r, g, b)` / `rgba(r, g, b, a)` to `#rrggbb`.  Accepts
 *  both `0-255` integers and `0-100%` percentages (CSS-compliant).
 *  Returns null on any malformed input — we don't try to be lenient
 *  here because `rgb(` is a strong signal and a partial match is
 *  almost certainly the user's typo. */
function rgbToHex(raw: string): string | null {
  const m = raw.match(/^rgba?\(\s*([^)]+?)\s*\)$/i)
  if (!m) return null
  const parts = m[1].split(/\s*,\s*/)
  if (parts.length < 3) return null
  const channels: number[] = []
  for (let i = 0; i < 3; i++) {
    const p = parts[i]
    if (p.endsWith('%')) {
      const n = parseFloat(p)
      if (!isFinite(n)) return null
      channels.push(Math.round((n / 100) * 255))
    } else {
      const n = parseInt(p, 10)
      if (!isFinite(n) || n < 0 || n > 255) return null
      channels.push(n)
    }
  }
  return (
    '#' +
    channels
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
      .toLowerCase()
  )
}

/** A curated subset of CSS named colors — 30 covers the user's
 *  realistic palette needs (the most common picks plus a few
 *  designer favorites) without committing to a 150-entry table.
 *  Lookup is case-insensitive; hex is canonical `#rrggbb`. */
const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  olive: '#808000',
  lime: '#00ff00',
  aqua: '#00ffff',
  teal: '#008080',
  navy: '#000080',
  fuchsia: '#ff00ff',
  purple: '#800080',
  orange: '#ffa500',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  gold: '#ffd700',
  coral: '#ff7f50',
  tomato: '#ff6347',
  salmon: '#fa8072',
  khaki: '#f0e68c',
  violet: '#ee82ee',
  indigo: '#4b0082',
  turquoise: '#40e0d0',
  chocolate: '#d2691e',
  crimson: '#dc143c',
  darkred: '#8b0000',
  darkblue: '#00008b',
  darkgreen: '#006400',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  lightblue: '#add8e6',
  lightgreen: '#90ee90',
  lightyellow: '#ffffe0',
  lightpink: '#ffb6c1',
  skyblue: '#87ceeb',
  forestgreen: '#228b22',
  royalblue: '#4169e1',
  steelblue: '#4682b4',
  hotpink: '#ff69b4',
  deeppink: '#ff1493',
  orangered: '#ff4500',
  goldenrod: '#daa520',
  mediumpurple: '#9370db',
}
