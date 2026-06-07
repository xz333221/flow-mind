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
  /** Direction this node's children fan out in, as a signed scalar
   *  (1 = right, -1 = left).  Mirrors `_dir` for callers that need
   *  a number.  Kept in sync by applyDoLayout and forceRight — when
   *  the height-based balancer moves a child to the opposite side,
   *  the whole subtree gets its `side` / `_dir` / `_dirRight`
   *  re-stamped so descendants fan the right way. */
  _dirRight: 1 | -1
  /** Layout-only: vertical extent of this node's subtree (post-order
   *  walk result, read by layoutHorizontal).  Not for public use. */
  _subtreeH: number
  /** Layout-only: horizontal extent of this node's subtree (read by
   *  layoutVertical / org mode).  Not for public use. */
  _subtreeW: number
  /** Optional embedded image (mirrored from MindMapNode.image).
   *  The renderer uses src/width/height; naturalW/H lock the
   *  resize aspect ratio. */
  image?: MindMapImage
  /** Mirrored from MindMapNode.link.  Read by the renderer to
   *  show a link icon next to the text. */
  link?: { url: string }
  /** Mirrored from MindMapNode.note.  Read by the renderer to
   *  show a note icon next to the text. */
  note?: { text: string }
  children: LayoutNode[]
  parent: LayoutNode | null
}

import type { MindMapNode, MindMapImage } from '../types'

// =====================================================================
// Node metrics — 1.html's getNodeStyle() table (1.html JS L332-338).
// Index 0 = root, 1 = top branch, 2 = sub-branch, 3+ = leaf tier.
// Width is content-measured; minW + padH are the only constants we
// keep here.  Height is fixed per level (1.html does the same).
// =====================================================================
// XMind-style tier metrics — root is large and pill-shaped, level 1
// is medium with a clear visual gap, levels 2-3 step down through a
// tighter spacing curve so the canvas reads as a clear hierarchy
// (root > topic > sub-topic > leaf) rather than a uniform decay.
// Index 0 = root, 1 = top branch, 2 = sub-branch, 3+ = leaf tier.
const NODE_FONTS = [18, 15, 13, 12]
const NODE_FONT_WEIGHTS = [700, 600, 500, 400]
const NODE_HEIGHTS = [52, 40, 32, 28]
const NODE_MIN_W = [120, 80, 60, 44]
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
// For nodes that carry an image, the box grows to fit the image above
// the text (image width forces a wider box, image+gap+text forces a
// taller box).  For nodes with a link or note icon, the text row
// gains a fixed-size "icon tray" (16px per icon + 4px gap) so the
// layout's reserved width matches the rendered DOM.  Without this,
// the node's actual on-screen width grows past the layout's
// reserved width, and edge anchors (computed from the layout width)
// end up piercing the box.
//
// `image` dimensions are clamped to a sensible range so a bad
// import doesn't blow up the layout.
// =====================================================================
const IMG_MIN_W = 24
const IMG_MAX_W = 400
const IMG_GAP = 8

/** Per-icon reserved slot in the text row.  MUST match the
 *  `width` / `height` of `.zm-node-link` and `.zm-node-note-btn`
 *  in MindMap.vue.  If you change the icon size, change this. */
const ICON_SLOT = 16
/** Gap between adjacent icons (and between the last icon and the
 *  text label) in the text row.  MUST match `gap` on `.zm-text`. */
const ICON_GAP = 4

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function calcNodeSize(node: MindMapNode, level: number): { w: number; h: number } {
  const t = tierFor(level)
  const textW = measureText(node.text || '', NODE_FONTS[t], NODE_FONT_WEIGHTS[t])
  const pad = padPx(level)
  const textWWithPad = Math.ceil(textW + pad * 2)
  const textH = NODE_HEIGHTS[t]
  // Reserve space for the inline icons: each link/note icon is
  // 16px + 4px gap (only between adjacent icons; no trailing gap
  // — the text label sits right after the last icon).
  let iconTrayW = 0
  if (node.link) iconTrayW += ICON_SLOT
  if (node.note) iconTrayW += ICON_SLOT
  if (iconTrayW > 0) {
    // First icon sits to the right of the label with ICON_GAP
    // between them; subsequent icons add another ICON_GAP each.
    const iconCount = (node.link ? 1 : 0) + (node.note ? 1 : 0)
    iconTrayW += ICON_GAP * iconCount
  }
  const textRowW = textWWithPad + iconTrayW
  if (!node.image) {
    const w = Math.max(NODE_MIN_W[t], textRowW)
    return { w, h: textH }
  }
  // Has an image: width accommodates the wider of the text row or
  // the image; height stacks the image + gap + text region.
  const imgW = clamp(node.image.width, IMG_MIN_W, IMG_MAX_W)
  const w = Math.max(NODE_MIN_W[t], textRowW, Math.ceil(imgW + pad * 2))
  const h = Math.ceil(node.image.height + IMG_GAP + textH)
  return { w, h }
}

export type LayoutMode = 'mindmap' | 'tree' | 'org'

export interface LayoutOptions {
  mode?: LayoutMode
  /** @deprecated kept for API compat; ignored in 1.html-style layout. */
  balanced?: boolean
  /**
   * When true, layout() leaves each LayoutNode's existing x/y in
   * place — it still does the doLayout split / redirect / stack
   * walk, but skips writing to child.x / child.y.  Used after a
   * drag: we commit the offset into the data tree, clear the
   * per-node offset map, then re-run layout with this flag so
   * the dragged node (and its subtree) stay where the user put
   * them.  The root is still forced to (0, 0) — to put the
   * dragged node at a new position, the surrounding tree moves
   * relative to it.  New nodes added later get the algorithmic
   * position since their LayoutNode has x = 0, y = 0.
   */
  preservePositions?: boolean
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
  const preservePositions = options.preservePositions === true
  const lr = buildLayout(root, 0, null, 1, 'right')

  // 1.html interleaves calcSubtreeH with doLayout.  We split into two
  // passes: extents first (post-order, so leaves are computed before
  // their parents), then doLayout.  Functionally equivalent.
  computeSubtreeExtents(lr)
  applyDoLayout(lr, mode, preservePositions)

  // Place root at (0, 0) per 1.html convention.
  lr.x = 0
  lr.y = 0

  return computeBounds(lr, preservePositions)
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
function applyDoLayout(root: LayoutNode, mode: LayoutMode, preservePositions: boolean = false): void {
  if (mode === 'mindmap') {
    // Split root's children so that the *sum of subtree heights* on
    // each side is as close to half of the total as possible, while
    // preserving the input order.  This is a classic partition
    // problem — for small N we just try every cut point and pick the
    // one with the smallest |left - right|.  For N > 32 the search
    // degrades to a single greedy approximation (first child on
    // whichever side currently has less), but the root of a
    // mindmap rarely has more than a dozen top-level branches.
    //
    // Why not a fixed `slice(0, ceil(n/2))`?  When one child is
    // much taller than the rest (e.g. 6 deep subtrees vs 4 deep
    // subtrees vs 3 deep subtrees), the visual "fan" around the
    // root goes lopsided and the root ends up below the canvas
    // mid-line.  Balancing by height keeps the root visually
    // centered.
    //
    // Why not a strict greedy-by-height that scrambles the order?
    // Because the user wants the *order* to be predictable: walking
    // the data tree 1, 2, 3, … should read the canvas 1, 2, 3, …
    // clockwise.  A single best-cut partition preserves order.
    const kids = root.children
    if (kids.length === 0) {
      // No split to do — root has no top-level children.
    } else if (kids.length === 1) {
      // Single child always goes right.
      kids[0]._dir = 'right'
      kids[0].side = 1
      kids[0]._dirRight = 1
    } else {
      const totalH = kids.reduce((s, c) => s + c._subtreeH, 0)
      let bestCut = 1 // at least one child on the right
      let bestDiff = Math.abs(kids[0]._subtreeH - (totalH - kids[0]._subtreeH))
      let acc = 0
      for (let i = 0; i < kids.length - 1; i++) {
        acc += kids[i]._subtreeH
        const diff = Math.abs(acc - (totalH - acc))
        if (diff < bestDiff) {
          bestDiff = diff
          bestCut = i + 1
        }
      }
      for (let i = 0; i < bestCut; i++) {
        kids[i]._dir = 'right'
        kids[i].side = 1
        kids[i]._dirRight = 1
      }
      for (let i = bestCut; i < kids.length; i++) {
        kids[i]._dir = 'left'
        kids[i].side = -1
        kids[i]._dirRight = -1
      }
    }
    const rightKids = root.children.filter((c) => c.side === 1)
    const leftKids = root.children.filter((c) => c.side === -1)
    // redirectSubtree: a child landed on the OPPOSITE side from what
    // buildLayout assigned.  The loop above already stamped the
    // child's own _dir/side/_dirRight to the new side, but its
    // descendants still inherit the *old* side from buildLayout —
    // without recursing in, grandchildren would still be on the
    // build-time side, drawing lines back across the center.  Walk
    // each redirected child's subtree and force every node's
    // _dir/side/_dirRight to the new side.  We don't touch x/y yet
    // — layoutHorizontal (next call) recomputes them from `_dir`.
    const redirectSubtree = (n: LayoutNode, dir: 'right' | 'left') => {
      const d = dir === 'right' ? (1 as const) : (-1 as const)
      n._dir = dir
      n.side = d
      n._dirRight = d
      for (const c of n.children) redirectSubtree(c, dir)
    }
    for (const c of rightKids) redirectSubtree(c, 'right')
    for (const c of leftKids) redirectSubtree(c, 'left')
    // layoutHorizontal takes (node, dir) and walks node.children —
    // it can't be called twice on the same parent with different
    // dirs (the second call would stomp the first's _dir).  So we
    // build a synthetic parent per side whose `.children` is just
    // that side's kids.  This is the same trick 1.html uses
    // implicitly via its doLayout arms.
    if (rightKids.length > 0) {
      const rightParent: LayoutNode = { ...root, children: rightKids }
      layoutHorizontal(rightParent, 'right', H_GAP, true, preservePositions)
    }
    if (leftKids.length > 0) {
      const leftParent: LayoutNode = { ...root, children: leftKids }
      layoutHorizontal(leftParent, 'left', H_GAP, true, preservePositions)
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
      for (const c of n.children) forceRight(c)
    }
    for (const c of root.children) c._dir = 'right'
    layoutHorizontal(root, 'right', H_GAP, true, preservePositions)
    forceRight(root)
  } else {
    // 'org' — all children fan downward
    for (const c of root.children) c._dir = 'down'
    layoutVertical(root, H_GAP, preservePositions)
  }
}

// =====================================================================
// layoutHorizontal — 1.html JS L399-410.  Children are stacked
// vertically.  At the *root* level the starting y and iteration
// direction depend on `dir` so the visual order matches a
// *clockwise sweep around the root*:
//   - dir='right' (right-side children): first child at the top, last
//     at the bottom.  cy starts at node.y - totalH/2 and grows
//     downward.
//   - dir='left'  (left-side children): first child at the bottom,
//     last at the top.  cy starts at node.y + totalH/2 and shrinks
//     upward.
// Deeper subtrees (level 2+) always stack top→bottom regardless of
// which side of the root they live on — that's the xmind convention:
// only the root sweep is clockwise; below that, children follow their
// parent's data order from top to bottom.
//
// x placement: x = node.x + sign * (node.w/2 + hGap + child.w/2)
// y placement: y = cy + sign * child._subtreeH / 2 (root) | y = cy +
//   child._subtreeH/2 (subtree, top→bottom)
// Then recurse with `applyClockwise=false` so children of children
// stack normally.
// =====================================================================
function layoutHorizontal(
  node: LayoutNode,
  dir: 'right' | 'left',
  hGap: number,
  applyClockwise: boolean,
  preserve: boolean = false
): void {
  if (node.children.length === 0) return
  const totalH = node.children.reduce(
    (s, c, i) => s + c._subtreeH + (i > 0 ? V_GAP : 0),
    0
  )
  const sign = dir === 'right' ? 1 : -1
  // Root sweep uses sign to flip the start and step.  Subtrees
  // always use sign=+1 (top→bottom) so the per-level ordering is
  // independent of the side they happen to be on.
  const step = applyClockwise ? sign : 1
  let cy = node.y - step * totalH / 2
  node.children.forEach((child) => {
    // When preserve=true, keep the LayoutNode's existing x/y
    // (the user just dragged this subtree to a new spot).  We
    // still set _dir so the line anchor / side / ribbon
    // orientation follow the new split.
    if (!preserve) {
      child.x = node.x + sign * (node.width / 2 + hGap + child.width / 2)
      child.y = cy + step * child._subtreeH / 2
    }
    child._dir = dir
    cy += step * (child._subtreeH + V_GAP)
    layoutHorizontal(child, dir, hGap, false, preserve)
  })
}

// =====================================================================
// layoutVertical — 1.html JS L413-424.  Mirrored horizontally.
// Children stack horizontally; the row is centered on the parent's x.
// =====================================================================
function layoutVertical(node: LayoutNode, vGap: number, preserve: boolean = false): void {
  if (node.children.length === 0) return
  const totalW = node.children.reduce(
    (s, c, i) => s + c._subtreeW + (i > 0 ? V_GAP * 2 : 0),
    0
  )
  let cx = node.x - totalW / 2
  node.children.forEach((child) => {
    if (!preserve) {
      child.x = cx + child._subtreeW / 2
      child.y = node.y + node.height / 2 + vGap + child.height / 2
    }
    child._dir = 'down'
    cx += child._subtreeW + V_GAP * 2
    layoutVertical(child, vGap, preserve)
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
    // Honor a user-set position from the data tree (drag commit).
    // The next applyDoLayout pass will overwrite these unless
    // preservePositions is true.
    x: node._x ?? 0,
    y: node._y ?? 0,
    width: size.w,
    height: size.h,
    fontSize: fontAt(depth),
    isRoot: depth === 0,
    collapsed: node.collapsed,
    side,
    _dir: dir,
    _dirRight: side,
    _subtreeH: size.h,
    _subtreeW: size.w,
    image: node.image ? { ...node.image } : undefined,
    link: node.link ? { url: node.link.url } : undefined,
    note: node.note ? { text: node.note.text } : undefined,
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
function computeBounds(lr: LayoutNode, preservePositions: boolean = false): {
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
  if (preservePositions) {
    // User has just dragged nodes to specific spots.  Skip the
    // SIDE_PADDING yShift that centers the tree in its bbox —
    // the user's coordinates are the source of truth and
    // shouldn't be displaced.  The viewBox will cover the
    // existing coordinates plus half the widest node as left/
    // right padding (see below).
    return {
      root: lr,
      width: maxX - minX + SIDE_PADDING * 2,
      height: maxY - minY + SIDE_PADDING * 2,
      vbX: minX - SIDE_PADDING,
      vbY: minY - SIDE_PADDING,
      vbW: maxX - minX + SIDE_PADDING * 2,
      vbH: maxY - minY + SIDE_PADDING * 2,
    }
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
