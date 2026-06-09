import { describe, expect, it } from 'vitest'
import { layout, type LayoutNode } from './layout'
import type { MindMapNode } from '../types'

/**
 * Verify the SVG line-anchor inset for code/table rich-content
 * nodes.  The layout stamps `_richInsetX` on the LayoutNode so
 * `lineAnchor()` in MindMap.vue retreats the 'in' edge anchor
 * from the geometric box edge to the visible content edge.
 * A non-zero value stops the ribbon from visually piercing the
 * framed body; a zero value (plain nodes) preserves the original
 * "tip just inside the border" look.
 */
describe('layout._richInsetX', () => {
  function findNode(tree: LayoutNode, id: string): LayoutNode | null {
    if (tree.id === id) return tree
    for (const c of tree.children) {
      const r = findNode(c, id)
      if (r) return r
    }
    return null
  }

  it('stamps a non-zero inset for code nodes', () => {
    const tree: MindMapNode = {
      id: 'root', text: 'root', children: [
        { id: 'code1', text: '代码块', richContent: { kind: 'code', raw: '```ts\nconst x = 1\n```', lang: 'ts' }, children: [] },
      ],
    }
    const r = layout(tree, { baseFontSize: 14 })
    const code = findNode(r.root, 'code1')!
    // padPx(1, 14) = round(fontAt(1,14) * 0.8) = round(15 * 0.8) = 12
    // .zm-rich padding (6) + tip inset (2) → total 20
    expect(code._richInsetX).toBe(20)
  })

  it('stamps a non-zero inset for table nodes', () => {
    const tree: MindMapNode = {
      id: 'root', text: 'root', children: [
        { id: 'tab1', text: '表格', richContent: { kind: 'table', raw: '| a | b |\n| --- | --- |\n| 1 | 2 |' }, children: [] },
      ],
    }
    const r = layout(tree, { baseFontSize: 14 })
    const tab = findNode(r.root, 'tab1')!
    expect(tab._richInsetX).toBe(20)
  })

  it('leaves inset undefined for plain text nodes', () => {
    const tree: MindMapNode = {
      id: 'root', text: 'root', children: [
        { id: 'plain', text: '普通节点', children: [] },
      ],
    }
    const r = layout(tree, { baseFontSize: 14 })
    const plain = findNode(r.root, 'plain')!
    // Undefined so the renderer's `n._richInsetX ?? 2` falls
    // through to the original 2-px default.
    expect(plain._richInsetX).toBeUndefined()
  })

  it('leaves inset undefined for paragraph / list rich content', () => {
    // Only code / table kinds get the inset — paragraph / list
    // sit BELOW the title, so the geometric edge is the visible
    // edge for the line anchor.
    const tree: MindMapNode = {
      id: 'root', text: 'root', children: [
        { id: 'p', text: '段落', richContent: { kind: 'paragraph', raw: '一段文字' }, children: [] },
        { id: 'l', text: '列表', richContent: { kind: 'list', raw: '- a\n- b' }, children: [] },
      ],
    }
    const r = layout(tree, { baseFontSize: 14 })
    expect(findNode(r.root, 'p')!._richInsetX).toBeUndefined()
    expect(findNode(r.root, 'l')!._richInsetX).toBeUndefined()
  })

  it('scales with baseFontSize (root padding 0.8em scales linearly)', () => {
    const tree: MindMapNode = {
      id: 'root', text: 'root', children: [
        { id: 'code1', text: '代码块', richContent: { kind: 'code', raw: '```ts\nconst x = 1\n```', lang: 'ts' }, children: [] },
      ],
    }
    const small = layout(tree, { baseFontSize: 14 })
    const large = layout(tree, { baseFontSize: 28 })
    const sInset = findNode(small.root, 'code1')!._richInsetX!
    const lInset = findNode(large.root, 'code1')!._richInsetX!
    // Larger base font → larger padding in px → larger inset.
    expect(lInset).toBeGreaterThan(sInset)
  })
})
