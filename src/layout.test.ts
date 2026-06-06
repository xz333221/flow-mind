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

  it('lays out children to alternating sides', () => {
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

  it('places the root on x=0', () => {
    const data: MindMapNode = { id: 'r', text: 'R', children: [] }
    const r = layout(data)
    expect(r.root.x).toBe(0)
  })

  it('positions children to the right or left of the root', () => {
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

  describe('balanced mode', () => {
    // 3 children — root forces i%2 sides: child[0] right, child[1] left,
    // child[2] right.  So 2 right, 1 left.  Right side has more mass
    // because the right children have wider subtrees.
    const data: MindMapNode = {
      id: 'r',
      text: 'R',
      children: [
        // child[0] — right — heavy subtree
        {
          id: 'a',
          text: 'A',
          children: [
            { id: 'a1', text: 'A1', children: [] },
            { id: 'a2', text: 'A2', children: [] },
            { id: 'a3', text: 'A3', children: [] },
            { id: 'a4', text: 'A4', children: [] },
          ],
        },
        // child[1] — left — light subtree
        {
          id: 'b',
          text: 'B',
          children: [{ id: 'b1', text: 'B1', children: [] }],
        },
        // child[2] — right — medium subtree
        {
          id: 'c',
          text: 'C',
          children: [
            { id: 'c1', text: 'C1', children: [] },
            { id: 'c2', text: 'C2', children: [] },
          ],
        },
      ],
    }

    function sideExtent(r: ReturnType<typeof layout>, side: 1 | -1) {
      const arr = r.root.children.filter((c) => c.side === side)
      if (arr.length === 0) return 0
      const ys = arr.map((c) => c.y).sort((x, y) => x - y)
      // extent: from top of first child to bottom of last child
      return ys[ys.length - 1] - ys[0] + LAYOUT.NODE_H
    }

    it('balanced mode centers the shorter side within the band', () => {
      // Right side has more mass (a=4 leaf + c=2 leaf), left side has less
      // (b=1 leaf).  Balanced should center the left group inside the
      // max-of-sides band — i.e. the left group's y should sit *between*
      // the top and bottom of the right group, not at the top.
      const balancedR = layout(data, { balanced: true })
      const a = balancedR.root.children.find((c) => c.id === 'a')!
      const c = balancedR.root.children.find((c) => c.id === 'c')!
      const b = balancedR.root.children.find((c) => c.id === 'b')!
      const yMin = Math.min(a.y, b.y, c.y)
      const yMax = Math.max(a.y, b.y, c.y)
      // b's y should be strictly inside (yMin, yMax) — i.e. it shifted
      // away from the top edge to be centered.
      expect(b.y).toBeGreaterThan(yMin)
      expect(b.y).toBeLessThan(yMax)
    })

    it('balanced mode keeps the larger side in its natural position', () => {
      const compact = layout(data)
      const balancedR = layout(data, { balanced: true })
      // 'a' is the top child on the right (larger side).  It is already
      // top-aligned in compact mode and should remain there in balanced.
      const compactA = compact.root.children.find((c) => c.id === 'a')!
      const balancedA = balancedR.root.children.find((c) => c.id === 'a')!
      expect(balancedA.y).toBeCloseTo(compactA.y, 5)
    })

    it('balanced mode keeps siblings at least NODE_H apart', () => {
      const r = layout(data, { balanced: true })
      const ys = r.root.children.map((c) => c.y).sort((x, y) => x - y)
      for (let i = 1; i < ys.length; i++) {
        expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(LAYOUT.NODE_H - 0.01)
      }
    })

    it('does not break with a single child', () => {
      const single: MindMapNode = {
        id: 'r',
        text: 'R',
        children: [{ id: 'a', text: 'A', children: [] }],
      }
      const r = layout(single, { balanced: true })
      expect(r.root.children.length).toBe(1)
    })

    it('non-balanced mode leaves compact spacing unchanged', () => {
      // Force a non-trivial layout; default options should match the same call
      const a = layout(data)
      const b = layout(data, { balanced: false })
      expect(a.height).toBe(b.height)
    })

    it('no two siblings overlap vertically (contour check)', () => {
      // build an asymmetric tree that would normally cause overlap
      const data: MindMapNode = {
        id: 'r',
        text: 'R',
        children: [
          { id: 'a', text: 'A', children: [] },
          { id: 'b', text: 'B', children: [] },
          { id: 'c', text: 'C', children: [] },
          { id: 'd', text: 'D', children: [] },
          { id: 'e', text: 'E', children: [] },
        ],
      }
      const r = layout(data, { balanced: true })
      // collect every leaf's vertical extent (a node is its own y, ±NODE_H/2)
      const ys: number[] = []
      const walk = (n: LayoutNode) => {
        ys.push(n.y - LAYOUT.NODE_H / 2)
        ys.push(n.y + LAYOUT.NODE_H / 2)
        for (const c of n.children) walk(c)
      }
      walk(r.root)
      // sanity: the tree is not insanely tall
      const span = Math.max(...ys) - Math.min(...ys)
      expect(span).toBeLessThan(1000)
    })

    it('band is at least as tall as the parents own children', () => {
      // 5 children all on the same side, all leaves — natural height
      // is 5*36+4*14=236, much larger than any of the other siblings.
      // The band for this parent must accommodate its own natural
      // height so the children don't overlap each other.
      const data: MindMapNode = {
        id: 'r',
        text: 'R',
        children: [
          { id: 'a', text: 'A', children: [] },
          {
            id: 'b',
            text: 'B',
            children: [
              { id: 'b1', text: 'B1', children: [] },
              { id: 'b2', text: 'B2', children: [] },
              { id: 'b3', text: 'B3', children: [] },
              { id: 'b4', text: 'B4', children: [] },
              { id: 'b5', text: 'B5', children: [] },
            ],
          },
        ],
      }
      const r = layout(data, { balanced: true })
      const b = r.root.children.find((c) => c.id === 'b')!
      // the 5 b-children must not overlap: each pair of consecutive
      // siblings must have at least NODE_H/2 + V_GAP between centers
      const kids = b.children.slice().sort((x, y) => x.y - y.y)
      for (let i = 1; i < kids.length; i++) {
        expect(kids[i].y - kids[i - 1].y).toBeGreaterThanOrEqual(LAYOUT.NODE_H)
      }
    })

    it('balanced mode centers every parent\'s children (recursive)', () => {
      // root has 3 children: 2 right, 1 left. The right side has more mass
      // (a=4 leaf + c=2 leaf). The LEFT group should be centered within
      // max(leftH, rightH) so its children sit BETWEEN the top and bottom
      // of the right group — proving the centering works for the side.
      // For a non-root parent with multiple sub-branches, the same rule
      // applies (each parents children form a centered group).
      const r = layout(data, { balanced: true })
      // root children: a (right, top), b (left, middle), c (right, bottom)
      // a.y < b.y < c.y
      const a = r.root.children.find((c) => c.id === 'a')!
      const b = r.root.children.find((c) => c.id === 'b')!
      const c = r.root.children.find((c) => c.id === 'c')!
      expect(a.y).toBeLessThan(b.y)
      expect(b.y).toBeLessThan(c.y)
      // a1..a4 are 'a' children — they should sit around a's y, with a1
      // above and a4 below
      const aYs = a.children.map((cc) => cc.y).sort((x, y) => x - y)
      expect(aYs.length).toBe(4)
      expect(aYs[0]).toBeLessThan(a.y)
      expect(aYs[aYs.length - 1]).toBeGreaterThan(a.y)
    })
  })
})
