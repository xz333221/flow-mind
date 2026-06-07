// =====================================================================
// Mind-map layout — mirrors demo/1.html's doLayout() / calcSubtreeH /
// layoutHorizontal / layoutVertical (1.html JS L398-492).
//
// Three modes: 'mindmap' (center + left/right fans), 'tree' (single
// column expanding to the right), 'org' (root at top, children
// fanning downward).  Each LayoutNode carries a `_dir` ('right' |
// 'left' | 'down') so the connection layer can pick the right anchor
// formula.  1.html uses the same flag to choose horizontal vs
// vertical control-point offsets for the bezier.
//
// All coordinates are node *centers* (not top-left).  The renderer
// applies `transform: translate(-50%,-50%)` to recenter the box
// visually — same trick 1.html uses (CSS L71).
// =====================================================================

export interface LayoutNode {
  id: string
  text: string
  depth: number
  x: number
  y: number
  width: number
  height: number
  /** Font size to render this node's text at, in px. */
  fontSize: number
  isRoot: boolean
  collapsed?: boolean
  side: 1 | -1
  /**
   * Direction this node's children fan out in: 'right' (default for
   * mindmap right side / tree), 'left' (mindmap left side), or 'down'
   * (org mode).
   */
  _dir: 'right' | 'left' | 'down'
  /** Direction the node itself points AWAY from its parent, as a
   *  signed scalar (1 = right, -1 = left).  Mirrors `_dir` for
   *  callers that need a number, not a string.  Used by the canvas
   *  line anchor so it follows the actual layout split — which can
   *  differ from the build-time `side` if the height-based balancer
   *  moves a child across the center line. */
  _dirRight: 1 | -1
  /** Layout-only: vertical extent of this node's subtree (post-order
   *  walk result, read by layoutHorizontal).  Not for public use. */
  _subtreeH: number
  /** Layout-only: horizontal extent of this node's subtree (read by
   *  layoutVertical / org mode).  Not for public use. */
  _subtreeW: number
  children: LayoutNode[]
  parent: LayoutNode | null
}

import type { MindMapNode } from '../types'

// =====================================================================
// Node metrics — 1.html's getNodeStyle() table (1.html JS L332-338).
// Index 0 = root, 1 = top branch, 2 = sub-branch, 3+ = leaf tier.
// Width is content-measured; minW + padH are the only constants we
// keep here.  Height is fixed per level (1.html does the same).
// =====================================================================
const NODE_FONTS = [17, 14, 13, 12]
const NODE_FONT_WEIGHTS = [700, 500, 400, 300]
const NODE_HEIGHTS = [48, 38, 30, 26]
const NODE_MIN_W = [100, 70, 50, 40]
/** Horizontal padding in `em`, matching `.zm-node { padding: 0 1.6em }`
 *  in MindMap.vue.  Keep these in sync or the SVG edges will pierce
 *  the node box (1.6em > the px value previously here for tiers 2/3,
 *  which is why sub-branch ribbons visibly entered the node). */
const NODE_PAD_EM = [1.6, 1.6, 1.6, 1.6]
const MAX_TIER = NODE_FONTS.length - 1

function padPx(depth: number): number {
  return Math.round(NODE_FONTS[tierFor(depth)] * NODE_PAD_EM[tierFor(depth)])
}

function tierFor(depth: number) {
  return Math.min(MAX_TIER, Math.max(0, depth))
}
function heightAt(depth: number) {
  return NODE_HEIGHTS[tierFor(depth)]
}
function fontAt(depth: number) {
  return NODE_FONTS[tierFor(depth)]
}

// =====================================================================
// Gaps — keep z-mind defaults (H_GAP=60, V_GAP=14).  1.html uses 70/10
// but z-mind's existing tests assume 60/14; we match the project.
// =====================================================================
const H_GAP = 60
const V_GAP = 14
const SIDE_PADDING = 24

// =====================================================================
// Text measurement — same role as 1.html's measureText() (JS L327).
// A single offscreen canvas + a Map cache keeps repeated calls cheap.
// SSR / non-DOM fallback returns 0 widths so layout still produces
// a usable (if conservative) result.
// =====================================================================
let _measureCtx: CanvasRenderingContext2D | null = null
function measureCtx(): CanvasRenderingContext2D {
  if (_measureCtx) return _measureCtx
  const c =
    typeof document !== 'undefined'
      ? document.createElement('canvas').getContext('2d')
      : null
  if (!c) {
    return {
      font: '',
      measureText: () => ({ width: 0 }) as TextMetrics,
    } as unknown as CanvasRenderingContext2D
  }
  _measureCtx = c
  return c
}
const _measureCache = new Map<string, number>()
function measureText(text: string, fontSize: number, fontWeight: number): number {
  const key = `${fontWeight}|${fontSize}|${text}`
  const cached = _measureCache.get(key)
  if (cached !== undefined) return cached
  const ctx = measureCtx()
  ctx.font = `${fontWeight} ${fontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`
  const w = ctx.measureText(text).width
  _measureCache.set(key, w)
  return w
}

// =====================================================================
// calcNodeSize — 1.html JS L341-348.  width = max(minW, text+2*padH).
// =====================================================================
function calcNodeSize(node: MindMapNode, level: number): { w: number; h: number } {
  const t = tierFor(level)
  const textW = measureText(node.text || '', NODE_FONTS[t], NODE_FONT_WEIGHTS[t])
  const w = Math.max(NODE_MIN_W[t], Math.ceil(textW + padPx(level) * 2))
  return { w, h: NODE_HEIGHTS[t] }
}

export type LayoutMode = 'mindmap' | 'tree' | 'org'

export interface LayoutOptions {
  mode?: LayoutMode
  /** @deprecated kept for API compat; ignored in 1.html-style layout. */
  balanced?: boolean
}

export function layout(
  root: MindMapNode,
  options: LayoutOptions = {}
): {
  root: LayoutNode
  width: number
  height: number
  vbX: number
  vbY: number
  vbW: number
  vbH: number
} {
  const mode: LayoutMode = options.mode ?? 'mindmap'
  const lr = buildLayout(root, 0, null, 1, 'right')

  // 1.html interleaves calcSubtreeH with doLayout.  We split into two
  // passes: extents first (post-order, so leaves are computed before
  // their parents), then doLayout.  Functionally equivalent.
  computeSubtreeExtents(lr)
  applyDoLayout(lr, mode)

  // Place root at (0, 0) per 1.html convention.
  lr.x = 0
  lr.y = 0

  return computeBounds(lr)
}

// =====================================================================
// doLayout — 1.html JS L427-492.  Three modes:
//   - 'mindmap': first ceil(n/2) children fan to the right, rest to
//                the left; each side uses hGap (1.html uses 70, we use
//                60 to match z-mind's default).
//   - 'tree'   : all children fan to the right (single column).
//   - 'org'    : all children fan downward.
//
// Root is placed at (0,0).  In every mode the child's stack is
// *vertically centered* on the parent's y (1.html: cy starts at
// node.y - totalH/2).  This is the key behavioral difference from
// the old stackAt(0)-from-top code path — single-child parents end
// up with their child at the same y as the parent.
// =====================================================================
function applyDoLayout(root: LayoutNode, mode: LayoutMode): void {
  if (mode === 'mindmap') {
    // Split root's children by subtree HEIGHT, not by child count.
    // The old code did `slice(0, ceil(n/2))` which is fine when every
    // child has the same subtree height, but with a "4 leaves on the
    // left, 4 deep subtrees on the right" mix the right side ends up
    // much taller and the canvas gets lopsided.
    //
    // Greedy two-pointer split: walk the children in order and put
    // each one on the lighter side.  Preserves sibling order on both
    // sides.  Ties go to the right so a perfectly-symmetric input
    // still looks balanced (first half = right, second half = left).
    const kids = root.children
    const rightKids: LayoutNode[] = []
    const leftKids: LayoutNode[] = []
    let rightH = 0
    let leftH = 0
    for (const c of kids) {
      const h = c._subtreeH
      if (rightH <= leftH) {
        rightKids.push(c)
        rightH += h
      } else {
        leftKids.push(c)
        leftH += h
      }
    }
    for (const c of rightKids) { c._dir = 'right'; c._dirRight = 1 }
    for (const c of leftKids) { c._dir = 'left'; c._dirRight = -1 }
    // layoutHorizontal takes (node, dir) and walks node.children —
    // it can't be called twice on the same parent with different
    // dirs (the second call would stomp the first's _dir).  So we
    // build a synthetic parent per side whose `.children` is just
    // that side's kids.  This is the same trick 1.html uses
    // implicitly via its doLayout arms.
    if (rightKids.length > 0) {
      const rightParent: LayoutNode = { ...root, children: rightKids }
      layoutHorizontal(rightParent, 'right', H_GAP)
    }
    if (leftKids.length > 0) {
      const leftParent: LayoutNode = { ...root, children: leftKids }
      layoutHorizontal(leftParent, 'left', H_GAP)
    }
  } else if (mode === 'tree') {
    // Force every node in the tree to the right side.  The layout's
    // mindmap-side assignment is still on `n.side` from buildLayout
    // (first-half gets +1, rest gets -1), but in tree mode no branch
    // should ever fan out to the left — both the _dir and the side
    // are forced to +1 so the line anchor and ribbon orientation
    // stay consistent.
    const forceRight = (n: LayoutNode) => {
      n.side = 1
      n._dir = 'right'
      n._dirRight = 1
      for (const c of n.children) forceRight(c)
    }
    for (const c of root.children) { c._dir = 'right'; c._dirRight = 1 }
    layoutHorizontal(root, 'right', H_GAP)
    forceRight(root)
  } else {
    // 'org' — all children fan downward
    for (const c of root.children) c._dir = 'down'
    layoutVertical(root, H_GAP)
  }
}

// =====================================================================
// layoutHorizontal — 1.html JS L399-410.  Children are stacked
// vertically; the stack is centered on the parent's y (cy starts at
// node.y - totalH/2).  Each child sits at:
//   x = node.x + (right?+1:-1) * (node.w/2 + hGap + child.w/2)
//   y = cy + child._subtreeH / 2
// (cy is the top y of the child's subtree, so y is the child's center).
// Then recurse with the same dir, so the child's children fan in the
// same direction.
// =====================================================================
function layoutHorizontal(node: LayoutNode, dir: 'right' | 'left', hGap: number): void {
  if (node.children.length === 0) return
  const totalH = node.children.reduce(
    (s, c, i) => s + c._subtreeH + (i > 0 ? V_GAP : 0),
    0
  )
  let cy = node.y - totalH / 2
  const sign = dir === 'right' ? 1 : -1
  node.children.forEach((child) => {
    child.x = node.x + sign * (node.width / 2 + hGap + child.width / 2)
    child.y = cy + child._subtreeH / 2
    child._dir = dir
    cy += child._subtreeH + V_GAP
    layoutHorizontal(child, dir, hGap)
  })
}

// =====================================================================
// layoutVertical — 1.html JS L413-424.  Mirrored horizontally.
// Children stack horizontally; the row is centered on the parent's x.
// =====================================================================
function layoutVertical(node: LayoutNode, vGap: number): void {
  if (node.children.length === 0) return
  const totalW = node.children.reduce(
    (s, c, i) => s + c._subtreeW + (i > 0 ? V_GAP * 2 : 0),
    0
  )
  let cx = node.x - totalW / 2
  node.children.forEach((child) => {
    child.x = cx + child._subtreeW / 2
    child.y = node.y + node.height / 2 + vGap + child.height / 2
    child._dir = 'down'
    cx += child._subtreeW + V_GAP * 2
    layoutVertical(child, vGap)
  })
}

// =====================================================================
// buildLayout — measure every node, set isRoot/side, recurse.  Side
// (1 | -1) is assigned to the root's children only: first
// ceil(n/2) get +1, rest get -1 (1.html mindmap split).  Lower
// levels inherit their parent's side.  `_dir` is set by applyDoLayout.
// =====================================================================
function buildLayout(
  node: MindMapNode,
  depth: number,
  parent: LayoutNode | null,
  side: 1 | -1,
  dir: 'right' | 'left' | 'down'
): LayoutNode {
  const size = calcNodeSize(node, depth)
  const ln: LayoutNode = {
    id: node.id,
    text: node.text,
    depth,
    x: 0,
    y: 0,
    width: size.w,
    height: size.h,
    fontSize: fontAt(depth),
    isRoot: depth === 0,
    collapsed: node.collapsed,
    side,
    _dir: dir,
    // Default _dirRight to the build-time `side` for everyone; the
    // mindmap balancer and tree-mode forceRight overwrite it later
    // if needed.
    _dirRight: side as 1 | -1,
    _subtreeH: size.h,
    _subtreeW: size.w,
    children: [],
    parent,
  }
  if (node.collapsed) return ln
  const n = node.children.length
  const rightCount = Math.ceil(n / 2)
  ln.children = node.children.map((c, i) => {
    const childSide: 1 | -1 =
      depth === 0 ? (i < rightCount ? (1 as const) : (-1 as const)) : side
    return buildLayout(c, depth + 1, ln, childSide, dir)
  })
  return ln
}

// =====================================================================
// Subtree-extent pre-computation — 1.html's calcSubtreeH + calcSubtreeW
// (1.html JS L368-396).  Post-order: leaves first, then their parents.
// Both extents are stamped on the node as `_subtreeH` / `_subtreeW`.
// They're consumed by layoutHorizontal/Vertical in the next pass.
//
//   - leaf / collapsed: _subtreeH = own h, _subtreeW = own w
//   - internal:         _subtreeH = max(own h, sum(_subtreeH)+gaps)
//                       _subtreeW = max(own w, sum(_subtreeW)+gaps*2)
//
// max(own h, sum) means a tall parent can be the "tall pole" of its
// own subtree; the children then sit centered on it.
// =====================================================================
function computeSubtreeExtents(root: LayoutNode): void {
  const stack: LayoutNode[] = [root]
  // Build a post-order traversal: keep pushing children; the array
  // is then in pre-order, so we iterate in reverse to get post-order.
  for (let i = 0; i < stack.length; i++) {
    const n = stack[i]
    for (const c of n.children) stack.push(c)
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const n = stack[i]
    if (n.collapsed || n.children.length === 0) {
      n._subtreeH = n.height
      n._subtreeW = n.width
      continue
    }
    let totalH = 0
    let totalW = 0
    for (const c of n.children) {
      totalH += c._subtreeH
      totalW += c._subtreeW
    }
    if (n.children.length > 1) {
      totalH += V_GAP * (n.children.length - 1)
      totalW += V_GAP * 2 * (n.children.length - 1)
    }
    n._subtreeH = Math.max(n.height, totalH)
    n._subtreeW = Math.max(n.width, totalW)
  }
}

// =====================================================================
// computeBounds — walk the whole tree, collect min/max world coords,
// produce the viewBox rectangle (used by the renderer's SVG layer).
// We shift y so the topmost node sits at y=SIDE_PADDING (so the root,
// which is at y=0, has room for its top half above the viewBox
// origin).  x is NOT shifted — the viewBox starts at minX - padding.
// =====================================================================
function computeBounds(lr: LayoutNode): {
  root: LayoutNode
  width: number
  height: number
  vbX: number
  vbY: number
  vbW: number
  vbH: number
} {
  const stack: LayoutNode[] = [lr]
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  while (stack.length) {
    const cur = stack.pop()!
    const halfW = cur.width / 2
    const halfH = cur.height / 2
    if (cur.x - halfW < minX) minX = cur.x - halfW
    if (cur.x + halfW > maxX) maxX = cur.x + halfW
    if (cur.y - halfH < minY) minY = cur.y - halfH
    if (cur.y + halfH > maxY) maxY = cur.y + halfH
    stack.push(...cur.children)
  }
  const yShift = SIDE_PADDING - minY
  const s2: LayoutNode[] = [lr]
  while (s2.length) {
    const cur = s2.pop()!
    cur.y += yShift
    s2.push(...cur.children)
  }
  minY += yShift
  maxY += yShift
  return {
    root: lr,
    width: maxX - minX + SIDE_PADDING * 2,
    height: maxY + SIDE_PADDING,
    vbX: minX - SIDE_PADDING,
    vbY: 0,
    vbW: maxX - minX + SIDE_PADDING * 2,
    vbH: maxY + SIDE_PADDING,
  }
}

export const LAYOUT = {
  /** Legacy single-size values for callers that still expect them. */
  NODE_W: NODE_MIN_W[1],
  NODE_H: NODE_HEIGHTS[1],
  NODE_FONTS,
  NODE_HEIGHTS,
  NODE_MIN_W,
  NODE_PAD_H: NODE_PAD_EM,
  NODE_FONT_WEIGHTS,
  H_GAP,
  V_GAP,
  SIDE_PADDING,
  heightAt,
  fontAt,
  /** Clear the text-measurement cache (call after font load). */
  clearMeasureCache: () => _measureCache.clear(),
}
