export interface LayoutNode {
  id: string
  text: string
  depth: number
  x: number
  y: number
  width: number
  height: number
  /** Font size to render this node's text at, in px. Driven by depth so
   *  the root reads as the title and deeper nodes shrink to a min. */
  fontSize: number
  isRoot: boolean
  collapsed?: boolean
  side: 1 | -1
  children: LayoutNode[]
  parent: LayoutNode | null
}

import type { MindMapNode } from '../types'

// Depth-tiered node metrics — root reads as the title, branches step down,
// everything past `MAX_TIER` clamps to the smallest size (xmind style).
// Indices: 0 = root, 1 = top branch, 2 = sub-branch, 3+ = leaf tier.
const NODE_WIDTHS = [180, 140, 120, 110]
const NODE_HEIGHTS = [44, 36, 30, 28]
const NODE_FONTS = [18, 14, 13, 12]
const MAX_TIER = NODE_WIDTHS.length - 1

function tierFor(depth: number) {
  return Math.min(MAX_TIER, Math.max(0, depth))
}
function widthAt(depth: number) {
  return NODE_WIDTHS[tierFor(depth)]
}
function heightAt(depth: number) {
  return NODE_HEIGHTS[tierFor(depth)]
}
function fontAt(depth: number) {
  return NODE_FONTS[tierFor(depth)]
}

const H_GAP = 60
const V_GAP = 14
const SIDE_PADDING = 24

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

  // subtree height (sum of child heights + gaps)
  const subH = new Map<LayoutNode, number>()
  function computeSubH(n: LayoutNode): number {
    if (n.collapsed || n.children.length === 0) {
      subH.set(n, n.height)
      return n.height
    }
    let total = 0
    for (const c of n.children) total += computeSubH(c)
    if (n.children.length > 1) total += V_GAP * (n.children.length - 1)
    subH.set(n, total)
    return total
  }
  computeSubH(lr)

  // sum of a set of children's subtree heights + the V_GAPs between them
  function naturalH(children: LayoutNode[]): number {
    let total = 0
    for (const c of children) total += subH.get(c) ?? c.height
    if (children.length > 1) total += V_GAP * (children.length - 1)
    return total
  }

  // x positions — center-to-center distance is parent_half + gap + child_half,
  // so tiers of different widths line up cleanly along each column.
  function assignX(n: LayoutNode, px: number, pw: number) {
    n.x = n.isRoot ? 0 : px + n.side * (pw / 2 + H_GAP + n.width / 2)
    for (const c of n.children) assignX(c, n.x, n.width)
  }
  assignX(lr, 0, lr.width)

  // Compute band height for each parent: the height that ALL of its
  // siblings (i.e. other children of its parent) try to reach, so that
  // siblings are centered within the same band and their fans look
  // equally tall. For the root, "siblings" splits into left and right
  // bands, so we take the max of each side's natural height.
  // Each parent's own band stretches its children so all bands are equal.
  const rootBandL = naturalH(lr.children.filter((c) => c.side === -1))
  const rootBandR = naturalH(lr.children.filter((c) => c.side === 1))
  const rootBand = Math.max(rootBandL, rootBandR)

  // The "band" for a parent is the height that the group of its children
  // should occupy. For every parent, the band = max of its siblings' subtree
  // heights — so every sibling group reaches the same total height. In
  // both cases the children are TIGHTLY stacked (no slot stretching) and
  // the entire group is centered within the band; "tall" children stay
  // where they would be naturally, and "short" siblings get equal padding
  // above and below.
  // Siblings of c are: the other children of c.parent that share c.side.
  // For the root this gives the left/right grouping automatically.
  function getBandH(p: LayoutNode): number {
    if (p === lr || p.isRoot) return rootBand
    const sib = p.parent?.children ?? []
    if (sib.length === 0) return 0
    // The band for p is the max of:
    //   (a) the natural height of p's own children (so the band is
    //       always tall enough to fit them even if every sibling is
    //       shorter — this prevents self-overlap when p has more or
    //       bigger children than any sibling), and
    //   (b) the largest subtree height among p's siblings (so a
    //       lighter sibling gets centered against the heavier ones).
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

  // Root: lay out left and right groups independently.  Each side's band
  // is the max of the siblings it can see — for the left side that's the
  // max of left-side children, for the right side that's the max of
  // right-side children.  To make left/right see only their own siblings,
  // we temporarily wrap each side as a fake parent whose `.parent`
  // points to the real root but whose `children` is filtered.
  if (options.balanced) {
    const leftKids = lr.children.filter((c) => c.side === -1)
    const rightKids = lr.children.filter((c) => c.side === 1)
    // build fake parents that share getBandH's view of "siblings"
    const leftFake: LayoutNode = { ...lr, children: leftKids }
    const rightFake: LayoutNode = { ...lr, children: rightKids }
    // but we need their siblings lookup to be the filter result. Since
    // `getBandH` uses `parent.children` and our fake parents ARE lr,
    // we just override the children:  getBandH will look at the fake's
    // children (= the side's children) and find the max subH among them.
    place(leftFake, 0)
    place(rightFake, 0)
  } else {
    place(lr, 0)
  }

  // Center the root vertically so it sits at the visual center of its
  // children.  In compact mode, lr.y is set to the midpoint of the
  // single root-band.  In balanced mode, lr.y is the midpoint of the
  // band's vertical extent (which both sides share, since each side is
  // centered into the same band).
  if (options.balanced) {
    const left = lr.children.filter((c) => c.side === -1)
    const right = lr.children.filter((c) => c.side === 1)
    const lH = naturalH(left)
    const rH = naturalH(right)
    const bandH = Math.max(lH, rH)
    const lTop = (bandH - lH) / 2
    const rTop = (bandH - rH) / 2
    // both sides start at the same y and span the same band, so the
    // root's y is the band's center.
    lr.y = bandH / 2
    void lTop
    void rTop
  } else {
    const nat = naturalH(lr.children)
    lr.y = nat / 2
  }

  // Walk every node and find the actual bbox in world space, accounting
  // for each node's own (depth-tiered) width and height.
  const stack: LayoutNode[] = [lr]
  let minY = Infinity,
    maxY = -Infinity,
    leftX = 0,
    rightX = 0,
    rootH = lr.height
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
  void rootH
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
  // Root height scales with how many direct children attach, so
  // root-edge anchors have enough room to spread 4+ branches
  // along the side instead of bunching at a single y. Width is
  // fixed: changing it would push children into the root
  // rectangle (children are positioned at root.x ± (root.width/2
  // + H_GAP + child.width/2)).
  // Root keeps a fixed height regardless of how many direct
  // children it has — only the children's own y-positions
  // change with depth, the root's box stays put.
  const rootHeightBoost = 0
  const ln: LayoutNode = {
    id: node.id,
    text: node.text,
    depth,
    x: 0,
    y: 0,
    width: widthAt(depth),
    height: heightAt(depth) + rootHeightBoost,
    fontSize: fontAt(depth),
    isRoot: depth === 0,
    collapsed: node.collapsed,
    side,
    children: [],
    parent,
  }
  if (node.collapsed) return ln
  // Place the first (N-1) children by alternation (i%2) so the root
  // fans out symmetrically, but place the LAST child on whichever side
  // is currently smaller — that way adding a new child always
  // appends to the smaller side instead of leaving an orphan on the
  // larger side.
  let leftCount = 0
  let rightCount = 0
  const n = node.children.length
  for (let i = 0; i < n; i++) {
    const c = node.children[i]
    let childSide: 1 | -1
    if (!ln.isRoot) {
      childSide = side as 1 | -1
    } else if (i < n - 1) {
      // first N-1 children: alternate starting from right
      childSide = i % 2 === 0 ? 1 : -1
    } else {
      // last child: pick the smaller side so a new addition always
      // fills the empty space instead of stacking on the larger one
      childSide = rightCount <= leftCount ? 1 : -1
    }
    if (childSide === 1) rightCount++
    else leftCount++
    ln.children.push(buildLayout(c, depth + 1, ln, childSide))
  }
  return ln
}

export const LAYOUT = {
  // Legacy single-size values are kept as the *branch tier* (depth 1) so
  // existing callers (mostly tests) keep working.
  NODE_W: NODE_WIDTHS[1],
  NODE_H: NODE_HEIGHTS[1],
  NODE_WIDTHS,
  NODE_HEIGHTS,
  NODE_FONTS,
  H_GAP,
  V_GAP,
  SIDE_PADDING,
  widthAt,
  heightAt,
  fontAt,
}
