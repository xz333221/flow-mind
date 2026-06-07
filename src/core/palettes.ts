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
 * Parse a free-form text blob (newline- or comma-separated hex
 * codes, whitespace tolerated) into a cleaned color array.
 * Returns up to `maxColors` valid entries; malformed tokens are
 * silently dropped so the user can paste messy text and still
 * get a working palette.  Lowercases for stable dedup.
 */
export function parsePaletteInput(
  text: string,
  maxColors = 8
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const tokens = text.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean)
  for (const tok of tokens) {
    const hex = tok.startsWith('#') ? tok : '#' + tok
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) continue
    const lc = hex.toLowerCase()
    if (seen.has(lc)) continue
    seen.add(lc)
    out.push(lc)
    if (out.length >= maxColors) break
  }
  return out
}
