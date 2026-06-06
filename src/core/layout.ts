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
  children: LayoutNode[]
  parent: LayoutNode | null
}

import type { MindMapNode } from '../types'

// =====================================================================
// Node metrics — mirror demo/1.html's getNodeStyle() table.
// Index 0 = root, 1 = top branch, 2 = sub-branch, 3+ = leaf tier (clamped).
// Width is now content-measured in `measureNodeSize` below — minW comes
// from here, the actual width = max(minW, measuredText + 2*padH).
// =====================================================================
const NODE_FONTS = [18, 14, 13, 12]
const NODE_HEIGHTS = [48, 38, 30, 26]
const NODE_MIN_W = [100, 70, 50, 40]
const NODE_PAD_H = [32, 20, 14, 12]
const NODE_PAD_V = [14, 10, 7, 5]
const NODE_FONT_WEIGHTS = [700, 500, 400, 300]
const NODE_RADII = [28, 10, 6, 5]
const MAX_TIER = NODE_FONTS.length - 1

function tierFor(depth: number) {
  return Math.min(MAX_TIER, Math.max(0, depth))
}
function heightAt(depth: number) {
  return NODE_HEIGHTS[tierFor(depth)]
}
function fontAt(depth: number) {
  return NODE_FONTS[tierFor(depth)]
}
function radiusAt(depth: number) {
  return NODE_RADII[tierFor(depth)]
}

const H_GAP = 60
const V_GAP = 14
const SIDE_PADDING = 24

// =====================================================================
// Text measurement — same role as 1.html's measureText(). Node widths
// are content-driven, so we need a real font metric. We use a single
// offscreen <canvas> (mirroring 1.html's _measureCanvas) and cache
// per-style measurements. A Map keyed on `${weight}|${size}|${text}`
// makes repeated measurements of the same node cheap.
// =====================================================================
let _measureCtx: CanvasRenderingContext2D | null = null
function measureCtx(): CanvasRenderingContext2D {
  if (_measureCtx) return _measureCtx
  const c = document.createElement('canvas').getContext('2d')
  // SSR / non-DOM fallback — return 0 widths so layout still works.
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

function measureNodeSize(node: MindMapNode, depth: number): { w: number; h: number } {
  const t = tierFor(depth)
  const fontSize = NODE_FONTS[t]
  const fontWeight = NODE_FONT_WEIGHTS[t]
  const padH = NODE_PAD_H[t]
  const minW = NODE_MIN_W[t]
  const textW = measureText(node.text || '', fontSize, fontWeight)
  const w = Math.max(minW, Math.ceil(textW + padH * 2))
  const h = NODE_HEIGHTS[t]
  return { w, h }
}

export interface LayoutOptions {
  /**
   * When true, the root's left and right subtrees are stretched to share
   * the same total height. Gaps between siblings on the shorter side grow
   * so both bands reach the same height — like xmind's balanced layout.
   * Default false keeps the original compact spacing (fixed V_GAP).
   */
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
  const lr = buildLayout(root, 0, null, 1)

  // _subtreeH mirrors 1.html: a node's vertical extent on the canvas,
  // used both for sibling-stacking and for centering the parent.
  //   - leaf / collapsed: subtreeH = node's own height
  //   - internal:          subtreeH = max(node.h, sum(child.subtreeH) + gaps)
  //                       (the second term is the natural stack height;
  //                        the first term matters when a parent is taller
  //                        than its whole child fan, e.g. a fat root.)
  const subH = new Map<LayoutNode, number>()
  function computeSubH(n: LayoutNode): number {
    if (n.collapsed || n.children.length === 0) {
      subH.set(n, n.height)
      return n.height
    }
    let childrenTotal = 0
    for (const c of n.children) childrenTotal += computeSubH(c)
    if (n.children.length > 1) childrenTotal += V_GAP * (n.children.length - 1)
    // 1.html: max(own h, children stack) — own h only wins when the
    // parent is taller than its fan (rare for non-root parents).
    const ownH = n.height
    const h = Math.max(ownH, childrenTotal)
    subH.set(n, h)
    return h
  }
  computeSubH(lr)

  function naturalH(children: LayoutNode[]): number {
    let total = 0
    for (const c of children) total += subH.get(c) ?? c.height
    if (children.length > 1) total += V_GAP * (children.length - 1)
    return total
  }

  // x positions — center-to-center distance is parent_half + H_GAP + child_half,
  // so tiers of different widths line up cleanly along each column.
  function assignX(n: LayoutNode, px: number, pw: number) {
    n.x = n.isRoot ? 0 : px + n.side * (pw / 2 + H_GAP + n.width / 2)
    for (const c of n.children) assignX(c, n.x, n.width)
  }
  assignX(lr, 0, lr.width)

  // Root's left/right bands — 1.html takes the max so both sides reach
  // the same total height (the "stretches to the same band" behavior).
  const rootBandL = naturalH(lr.children.filter((c) => c.side === -1))
  const rootBandR = naturalH(lr.children.filter((c) => c.side === 1))
  const rootBand = Math.max(rootBandL, rootBandR)

  // getBandH: per 1.html, every parent's children should sit in a band
  // that is at least as tall as the natural stack of its own children,
  // and at least as tall as its siblings' tallest subtree on the same
  // side. This produces "balanced" fan heights by construction.
  function getBandH(p: LayoutNode): number {
    if (p.isRoot) return rootBand
    const sib = p.parent?.children ?? []
    if (sib.length === 0) return 0
    const myNat = naturalH(p.children)
    let sibMax = 0
    for (const s of sib) {
      if (s.side !== p.side) continue
      const h = subH.get(s) ?? s.height
      if (h > sibMax) sibMax = h
    }
    return Math.max(myNat, sibMax)
  }

  function place(parent: LayoutNode, startY: number) {
    const children = parent.children
    if (children.length === 0) return
    const nat = naturalH(children)
    // always tightly stack children first
    function stackAt(y: number) {
      // First pass: assign y to each child by simple stacking, but if a
      // child's subtree bounding box would overlap an earlier sibling's
      // subtree, push the child (and everything after it) down until
      // the overlap clears.  This is a simplified "contour collision"
      // check — we keep one contour per sibling (its y-extent), and if
      // the new child would intrude into a prior sibling's band, we
      // move it (and later siblings) past the intruding band.
      const placed: { y0: number; y1: number }[] = []
      for (let i = 0; i < children.length; i++) {
        const c = children[i]
        const h = subH.get(c) ?? c.height
        // smallest y we can place this child at, given prior siblings
        let yi = y
        for (const p of placed) {
          if (p.y1 + V_GAP > yi) yi = p.y1 + V_GAP
        }
        c.y = yi + h / 2
        // place grandchildren
        place(c, yi)
        placed.push({ y0: yi, y1: yi + h })
        y = yi + h + V_GAP
      }
    }
    if (!options.balanced) {
      stackAt(startY)
      return
    }
    // balanced: center the tight group inside the band.  Then check
    // pairwise whether the new siblings' subtrees still intrude into
    // each other — if so, grow the gap below the offending one.
    const band = getBandH(parent)
    const topPad = Math.max(0, band - nat) / 2
    stackAt(startY + topPad)
    // Resolve any remaining overlaps by pushing the later sibling
    // downward until it clears the intruding subtree.  This catches
    // cases where the contour check above didn't move anything
    // (because no child *invaded* another's bbox) but two children
    // end up with overlapping y-extents due to a non-trivial subtree
    // shape.  Iterate until stable.
    for (let pass = 0; pass < 4; pass++) {
      let moved = false
      for (let i = 1; i < children.length; i++) {
        const prev = children[i - 1]
        const cur = children[i]
        const prevH = subH.get(prev) ?? prev.height
        const curH = subH.get(cur) ?? cur.height
        const prevY0 = prev.y - prevH / 2
        const prevY1 = prev.y + prevH / 2
        const curY0 = cur.y - curH / 2
        const neededY1 = prevY1 + V_GAP
        if (curY0 < neededY1) {
          const shift = neededY1 - curY0
          // shift `cur` (and every later sibling) down by `shift`
          for (let j = i; j < children.length; j++) {
            children[j].y += shift
            // also push the entire subtree of c down by `shift`
            shiftSubtree(children[j], shift)
          }
          moved = true
        }
      }
      if (!moved) break
    }
  }

  // shift every descendant's y by `delta` to keep the tree coherent
  // after a sibling gets pushed down to clear an overlap.
  function shiftSubtree(n: LayoutNode, delta: number) {
    for (const c of n.children) {
      c.y += delta
      shiftSubtree(c, delta)
    }
  }

  // Root: lay out left and right groups independently so the balanced
  // band calculation treats each side's siblings as the "siblings" set
  // (we override children to filter by side).
  if (options.balanced) {
    const leftKids = lr.children.filter((c) => c.side === -1)
    const rightKids = lr.children.filter((c) => c.side === 1)
    // build fake parents that share getBandH's view of "siblings"
    const leftFake: LayoutNode = { ...lr, children: leftKids }
    const rightFake: LayoutNode = { ...lr, children: rightKids }
    place(leftFake, 0)
    place(rightFake, 0)
  } else {
    place(lr, 0)
  }

  // Center the root vertically — 1.html writes lr.y = totalH/2 where
  // totalH is the *combined* natural height of left+right subtrees (i.e.
  // the y-extent a single fan would have). In balanced mode, both sides
  // share rootBand, so root sits at bandH/2. In compact mode, both
  // sides are naturally max(left,right) and stacked from y=0; we want
  // the root centered in that combined extent.
  if (options.balanced) {
    lr.y = rootBand / 2
  } else {
    // Compact: combine left and right natural heights. The root sits
    // at the visual center of whichever side is taller (they are
    // already stacked from y=0, so the tall side defines the total
    // extent and the root goes to its midpoint).
    const nat = Math.max(rootBandL, rootBandR)
    lr.y = nat / 2
  }

  // Walk every node and find the actual bbox in world space, accounting
  // for each node's own (depth-tiered) width and height.
  const stack: LayoutNode[] = [lr]
  let minY = Infinity,
    maxY = -Infinity,
    leftX = 0,
    rightX = 0
  while (stack.length) {
    const cur = stack.pop()!
    const halfW = cur.width / 2
    const halfH = cur.height / 2
    if (cur.y - halfH < minY) minY = cur.y - halfH
    if (cur.y + halfH > maxY) maxY = cur.y + halfH
    if (cur.x - halfW < -leftX) leftX = -(cur.x - halfW)
    if (cur.x + halfW > rightX) rightX = cur.x + halfW
    stack.push(...cur.children)
  }
  // shift y so top of layout = SIDE_PADDING
  const topPad = SIDE_PADDING
  const yShift = topPad - minY
  const s2: LayoutNode[] = [lr]
  while (s2.length) {
    const cur = s2.pop()!
    cur.y += yShift
    s2.push(...cur.children)
  }
  minY += yShift
  maxY += yShift
  const vbX = -leftX - SIDE_PADDING
  const vbY = 0
  const vbW = leftX + rightX + SIDE_PADDING * 2
  const vbH = maxY + SIDE_PADDING
  return {
    root: lr,
    width: vbW,
    height: vbH,
    vbX,
    vbY,
    vbW,
    vbH,
  }
}

function buildLayout(
  node: MindMapNode,
  depth: number,
  parent: LayoutNode | null,
  side: 1 | -1
): LayoutNode {
  // Root keeps a fixed height regardless of how many direct
  // children it has — only the children's own y-positions
  // change with depth, the root's box stays put.
  const ln: LayoutNode = {
    id: node.id,
    text: node.text,
    depth,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    fontSize: fontAt(depth),
    isRoot: depth === 0,
    collapsed: node.collapsed,
    side,
    children: [],
    parent,
  }
  // Measure this node's content width (1.html style: max(minW, text+pad*2))
  const size = measureNodeSize(node, depth)
  ln.width = size.w
  ln.height = size.h
  if (node.collapsed) return ln
  // 1.html's mindmap-mode side split: the first ceil(n/2) children go
  // to the right, the rest go to the left. This is purely structural
  // (left/right alternation is NOT balanced per-child), and produces a
  // symmetric fan when n is even. When n is odd the right side has one
  // more child than the left.
  const n = node.children.length
  const rightCount = Math.ceil(n / 2)
  ln.children = node.children.map((c, i) =>
    buildLayout(
      c,
      depth + 1,
      ln,
      i < rightCount ? (1 as const) : (-1 as const)
    )
  )
  return ln
}

export const LAYOUT = {
  // Legacy single-size values are kept as the *branch tier* (depth 1) so
  // existing callers (mostly tests) keep working.
  NODE_W: NODE_MIN_W[1],
  NODE_H: NODE_HEIGHTS[1],
  NODE_FONTS,
  NODE_HEIGHTS,
  NODE_MIN_W,
  NODE_PAD_H,
  NODE_PAD_V,
  NODE_FONT_WEIGHTS,
  NODE_RADII,
  H_GAP,
  V_GAP,
  SIDE_PADDING,
  heightAt,
  fontAt,
  radiusAt,
  /** Clear the text-measurement cache (call after theme changes). */
  clearMeasureCache: () => _measureCache.clear(),
}
