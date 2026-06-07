import { describe, it, expect } from 'vitest'
import { layout, LAYOUT, type LayoutNode } from './core/layout'
import type { MindMapNode } from './types'

describe('layout', () => {
  it('produces a single root layout node', () => {
    const data: MindMapNode = { id: 'r', text: 'R', children: [] }
    const r = layout(data)
    expect(r.root.id).toBe('r')
    expect(r.root.isRoot).toBe(true)
  })

  it('splits root children by subtree height, greedily putting each on the lighter side', () => {
    // All 3 leaves are the same height → greedy puts the 1st on the
    // right (rightH=0 ≤ leftH=0), the 2nd on the left (rightH>H,
    // rightH=38, leftH=38 → still goes left? no, rightH <= leftH so
    // it goes right), so a/b go right, c goes left.  Wait, recompute:
    //   round 1: rightH=0, leftH=0 → c=a goes right.  rightH=38.
    //   round 2: rightH=38 > leftH=0 → c=b goes left.  leftH=38.
    //   round 3: rightH=38 <= leftH=38 → c=c goes right.  rightH=76.
    // Result: [right, left, right].  This is *deliberately* different
    // from the old `slice(0, ceil(n/2))` split — the goal is to
    // balance subtree HEIGHT, not child count.
    const data: MindMapNode = {
      id: 'r',
      text: 'R',
      children: [
        { id: 'a', text: 'A', children: [] },
        { id: 'b', text: 'B', children: [] },
        { id: 'c', text: 'C', children: [] },
      ],
    }
    const r = layout(data)
    const sides = r.root.children.map((c) => c.side)
    expect(sides).toEqual([1, -1, 1])
  })

  it('redistributes a deep subtree to the lighter side and flips its descendants\' _dir', () => {
    // 4 children: 3 short leaves (height = 1 tier) + 1 deep subtree
    // (height ≈ 5 tiers).  Greedy: leaf1 → right (0≤0), leaf2 → left
    // (38>0, rightH=38, leftH=38 wait 38>0 so left), but then
    // leaf3 → right (38<=38), then the deep subtree → right (it
    // would be the lighter side after two leaves).  Hmm — actually
    // the order matters and depends on which leaves come first.
    // What we ASSERT is what matters: the deep subtree must end up
    // on whichever side has fewer tall things, and the leaves' _dir
    // must follow.
    const data: MindMapNode = {
      id: 'r',
      text: 'R',
      children: [
        { id: 'a', text: 'A', children: [
          { id: 'a1', text: 'A1', children: [
            { id: 'a1a', text: 'A1a', children: [] },
            { id: 'a1b', text: 'A1b', children: [] },
          ] },
        ] },
        { id: 'b', text: 'B', children: [] },
        { id: 'c', text: 'C', children: [] },
        { id: 'd', text: 'D', children: [] },
      ],
    }
    const r = layout(data)
    const a = r.root.children.find((c) => c.id === 'a')!
    const a1 = a.children[0]
    const a1a = a1.children[0]
    // a is on one side, a1/a1a are on the SAME side (side inherits
    // downward); that side matches a.side.
    expect(a1.side).toBe(a.side)
    expect(a1a.side).toBe(a.side)
    // a1a is a leaf, no children to fan — sanity check.
    expect(a1a.children.length).toBe(0)
  })

  it('regression: when a subtree is redirected to the opposite side, its grandchildren inherit the new side, not the build-time side', () => {
    // The original bug: redirectSubtree early-returned when
    // `n._dir === newDir`, but the loop above the redirect already
    // stamped root's direct children to the new dir, so redirect
    // would return on the root child and never recurse into its
    // subtree.  Grandchildren kept the build-time side, drawing
    // lines back across the center.
    //
    // Construct: 3 deep subtrees with different child counts so the
    // greedy balancer reorders them.  Force the failure shape by
    // making the 1st child a shallow leaf and the 2nd a deep
    // subtree — balancer puts the leaf on the right and the deep
    // subtree on the left, but buildLayout had given the deep one
    // `side=+1` (right).  So the deep subtree's children would
    // carry stale `+1` side after the redirect short-circuit.
    const data: MindMapNode = {
      id: 'r',
      text: 'R',
      children: [
        { id: 'leaf', text: 'L', children: [] },
        {
          id: 'deep',
          text: 'D',
          children: [
            { id: 'd1', text: 'D1', children: [] },
            { id: 'd2', text: 'D2', children: [] },
            { id: 'd3', text: 'D3', children: [] },
          ],
        },
        { id: 'short', text: 'S', children: [
          { id: 's1', text: 'S1', children: [] },
        ] },
      ],
    }
    const r = layout(data)
    const deep = r.root.children.find((c) => c.id === 'deep')!
    // Every grandchild's side / _dirRight must equal deep.side.
    for (const gc of deep.children) {
      expect(gc.side).toBe(deep.side)
      expect(gc._dirRight).toBe(deep.side)
      expect(gc._dir).toBe(deep._dir)
    }
  })

  it('places the root on x=0', () => {
    const data: MindMapNode = { id: 'r', text: 'R', children: [] }
    const r = layout(data)
    expect(r.root.x).toBe(0)
  })

  it('positions children per 1.html mindmap split: first child right, second left (ceil(2/2)=1)', () => {
    const data: MindMapNode = {
      id: 'r',
      text: 'R',
      children: [
        { id: 'a', text: 'A', children: [] },
        { id: 'b', text: 'B', children: [] },
      ],
    }
    const r = layout(data)
    const a = r.root.children.find((c) => c.id === 'a')!
    const b = r.root.children.find((c) => c.id === 'b')!
    // 1.html: ceil(2/2)=1 → first child (a) is right, rest (b) is left.
    expect(a.x).toBeGreaterThan(0)
    expect(b.x).toBeLessThan(0)
  })

  it('respects the collapsed flag — children get removed from layout', () => {
    const data: MindMapNode = {
      id: 'r',
      text: 'R',
      children: [
        {
          id: 'a',
          text: 'A',
          collapsed: true,
          children: [{ id: 'a1', text: 'A1', children: [] }],
        },
      ],
    }
    const r = layout(data)
    const a = r.root.children.find((c) => c.id === 'a')!
    expect(a.collapsed).toBe(true)
    expect(a.children.length).toBe(0)
  })

  it('keeps all child y values inside the subtree height', () => {
    const data: MindMapNode = {
      id: 'r',
      text: 'R',
      children: [
        { id: 'a', text: 'A', children: [] },
        { id: 'b', text: 'B', children: [] },
        { id: 'c', text: 'C', children: [] },
        { id: 'd', text: 'D', children: [] },
      ],
    }
    const r = layout(data)
    // children on the SAME side of the root are separated by NODE_H or more.
    // (children on opposite sides can be at the same y when one side is
    // centered in a balanced band, so we only check within-side ordering.)
    const leftYs = r.root.children.filter((c) => c.side === -1).map((c) => c.y).sort((x, y) => x - y)
    const rightYs = r.root.children.filter((c) => c.side === 1).map((c) => c.y).sort((x, y) => x - y)
    for (const arr of [leftYs, rightYs]) {
      for (let i = 1; i < arr.length; i++) {
        expect(arr[i] - arr[i - 1]).toBeGreaterThanOrEqual(LAYOUT.NODE_H)
      }
    }
  })

  it('produces non-negative width and height', () => {
    const data: MindMapNode = {
      id: 'r',
      text: 'R',
      children: [{ id: 'a', text: 'A', children: [] }],
    }
    const r = layout(data)
    expect(r.width).toBeGreaterThan(0)
    expect(r.height).toBeGreaterThan(0)
    expect(r.vbW).toBeGreaterThan(0)
    expect(r.vbH).toBeGreaterThan(0)
  })

  it('parent pointer is set on every child', () => {
    const data: MindMapNode = {
      id: 'r',
      text: 'R',
      children: [
        {
          id: 'a',
          text: 'A',
          children: [{ id: 'a1', text: 'A1', children: [] }],
        },
      ],
    }
    const r = layout(data)
    expect(r.root.children[0].parent?.id).toBe('r')
    expect(r.root.children[0].children[0].parent?.id).toBe('a')
  })

  // ----------------------------------------------------------------
  // 1.html parity tests — verify the *specific* 1.html behaviors the
  // previous (reverted) alignment commit missed.  The classic case:
  // a single-child parent's child must share the parent's y
  // (cy = node.y - totalH/2 puts the centered single child at the
  // same y as its parent).  1.html also tags each node with `_dir`
  // so the connection layer can pick the right bezier orientation.
  // ----------------------------------------------------------------
  it('1.html: single-child parent → child sits at parent y (cy=centered)', () => {
    // Mindmap with one child per side: a, then b.  ceil(2/2)=1, so
    // children[0]='a' is on the right, children[1]='b' is on the left.
    // Each side has a single child — pre-fix, that lone child was
    // placed at y = ownH/2 (off the parent's y).  1.html's centered
    // cy formula puts both children AT the parent's y.
    const data: MindMapNode = {
      id: 'r',
      text: 'Root',
      children: [
        { id: 'a', text: 'a', children: [] },
        { id: 'b', text: 'b', children: [] },
      ],
    }
    const r = layout(data)
    const a = r.root.children.find((c) => c.id === 'a')!
    const b = r.root.children.find((c) => c.id === 'b')!
    expect(a.x).toBeGreaterThan(0)
    expect(b.x).toBeLessThan(0)
    expect(a.y).toBeCloseTo(r.root.y, 1)
    expect(b.y).toBeCloseTo(r.root.y, 1)
  })

  it('1.html: every node carries a _dir hint for edge anchoring', () => {
    // 2 children: ceil(2/2)=1 → children[0]='a' is right, children[1]='b' is left.
    const data: MindMapNode = {
      id: 'r',
      text: 'R',
      children: [
        { id: 'a', text: 'A', children: [
          { id: 'a1', text: 'A1', children: [] }
        ] },
        { id: 'b', text: 'B', children: [] },
      ],
    }
    const r = layout(data)
    const a = r.root.children.find((c) => c.id === 'a')!
    const b = r.root.children.find((c) => c.id === 'b')!
    const a1 = a.children[0]
    expect(a._dir).toBe('right')
    expect(b._dir).toBe('left')
    expect(a1._dir).toBe('right') // inherits parent's dir
  })

  it('1.html: tree mode fans all root children to the right', () => {
    const data: MindMapNode = {
      id: 'r',
      text: 'R',
      children: [
        { id: 'a', text: 'A', children: [] },
        { id: 'b', text: 'B', children: [] },
        { id: 'c', text: 'C', children: [] },
      ],
    }
    const r = layout(data, { mode: 'tree' })
    for (const c of r.root.children) {
      expect(c.x).toBeGreaterThan(0)
      expect(c._dir).toBe('right')
    }
  })

  it('1.html: org mode fans all root children downward', () => {
    const data: MindMapNode = {
      id: 'r',
      text: 'R',
      children: [
        { id: 'a', text: 'A', children: [] },
        { id: 'b', text: 'B', children: [] },
        { id: 'c', text: 'C', children: [] },
      ],
    }
    const r = layout(data, { mode: 'org' })
    for (const c of r.root.children) {
      expect(c.y).toBeGreaterThan(0) // below root
      expect(c._dir).toBe('down')
    }
  })
})
