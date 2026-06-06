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

  it('lays out children per demo/1.html mindmap split: first ceil(n/2) right, rest left', () => {
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
    // 1.html: slice(0, ceil(3/2)) = [a, b] go right, [c] goes left.
    expect(sides).toEqual([1, 1, -1])
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
