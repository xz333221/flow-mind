import { describe, it, expect, beforeEach } from 'vitest'
import { useHistory } from './composables/useHistory'
import type { MindMapNode } from './types'

const makeTree = (label = 'A'): MindMapNode => ({
  id: 'r',
  text: 'Root',
  children: [{ id: 'a', text: label, children: [{ id: 'a1', text: 'A1', children: [] }] }],
})

describe('useHistory', () => {
  let tree: MindMapNode
  beforeEach(() => {
    tree = makeTree('A')
  })

  it('starts empty', () => {
    const h = useHistory()
    expect(h.canUndo()).toBe(false)
    expect(h.canRedo()).toBe(false)
  })

  it('record creates the first state; nothing to undo yet', () => {
    const h = useHistory()
    h.record({ data: tree, offsets: {} })
    // only one snapshot — you can't undo a single state, you can only
    // rewind past it
    expect(h.canUndo()).toBe(false)
  })

  it('after two records you can undo once', () => {
    const h = useHistory()
    h.record({ data: tree, offsets: {} })
    h.record({ data: tree, offsets: {} })
    expect(h.canUndo()).toBe(true)
    const restored = h.undo()
    expect(restored).not.toBeNull()
    // restoring the v0 state
    expect(restored?.data.children[0].text).toBe('A')
    // one entry left
    expect(h.canUndo()).toBe(false)
    // the undone change is in the redo stack
    expect(h.canRedo()).toBe(true)
  })

  it('undo then redo re-applies the change', () => {
    const h = useHistory()
    h.record({ data: tree, offsets: {} })
    tree.children[0].text = 'A-changed'
    h.record({ data: tree, offsets: {} })
    expect(h.undo()?.data.children[0].text).toBe('A')
    expect(h.redo()?.data.children[0].text).toBe('A-changed')
  })

  it('returns null when there is nothing to undo / redo', () => {
    const h = useHistory()
    h.record({ data: tree, offsets: {} })
    expect(h.undo()).toBeNull()
    expect(h.redo()).toBeNull()
  })

  it('record after undo invalidates the redo branch', () => {
    const h = useHistory()
    h.record({ data: tree, offsets: {} })
    h.record({ data: tree, offsets: {} })
    h.undo()
    expect(h.canRedo()).toBe(true)
    // any new edit at this point should clear redo
    h.record({ data: tree, offsets: {} })
    expect(h.canRedo()).toBe(false)
  })

  it('reset clears the timeline', () => {
    const h = useHistory()
    h.record({ data: tree, offsets: {} })
    h.record({ data: tree, offsets: {} })
    h.reset()
    expect(h.canUndo()).toBe(false)
    expect(h.canRedo()).toBe(false)
  })

  it('respects maxSize by dropping the oldest snapshot', () => {
    const h = useHistory(2) // tiny cap
    h.record({ data: tree, offsets: {} })
    h.record({ data: tree, offsets: {} })
    h.record({ data: tree, offsets: {} })
    // capacity is 2, so only the last two states are retained
    expect(h.canUndo()).toBe(true) // one step back
    h.undo()
    expect(h.canUndo()).toBe(false) // no further history
  })

  it('multiple undos walk back through the timeline', () => {
    const h = useHistory()
    h.record({ data: tree, offsets: {} }) // captures initial state (text='A')
    tree.children[0].text = 'v1'
    h.record({ data: tree, offsets: {} }) // v1
    tree.children[0].text = 'v2'
    h.record({ data: tree, offsets: {} }) // v2
    tree.children[0].text = 'v3'
    h.record({ data: tree, offsets: {} }) // v3 — current
    expect(h.undo()?.data.children[0].text).toBe('v2')
    expect(h.undo()?.data.children[0].text).toBe('v1')
    expect(h.undo()?.data.children[0].text).toBe('A')
    expect(h.undo()).toBeNull() // nothing left
  })
})
