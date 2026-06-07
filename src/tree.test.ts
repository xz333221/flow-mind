import { describe, it, expect, beforeEach } from 'vitest'
import {
  uid,
  clone,
  findNode,
  findParent,
  removeNode,
  setNodeText,
  moveNode,
  addChild,
  addSibling,
  addSiblingBefore,
  duplicateNode,
  countDescendants,
  markdownToMindMap,
  mindMapToMarkdown,
  DEFAULT_NEW_NODE_TEXT,
} from './tree'
import type { MindMapNode } from './types'

const makeSample = (): MindMapNode => ({
  id: 'root',
  text: 'Root',
  children: [
    {
      id: 'a',
      text: 'A',
      children: [
        { id: 'a1', text: 'A1', children: [] },
        { id: 'a2', text: 'A2', children: [] },
      ],
    },
    {
      id: 'b',
      text: 'B',
      children: [{ id: 'b1', text: 'B1', children: [] }],
    },
  ],
})

let sample: MindMapNode
beforeEach(() => {
  sample = makeSample()
})

describe('uid', () => {
  it('returns a string with the expected prefix', () => {
    expect(uid()).toMatch(/^n_/)
  })
  it('returns unique values', () => {
    const set = new Set(Array.from({ length: 100 }, () => uid()))
    expect(set.size).toBe(100)
  })
})

describe('clone', () => {
  it('returns a deep copy', () => {
    const c = clone(sample)
    expect(c).toEqual(sample)
    expect(c).not.toBe(sample)
    expect(c.children[0]).not.toBe(sample.children[0])
  })
  it('mutations on the clone do not affect the original', () => {
    const c = clone(sample)
    c.children[0].text = 'changed'
    expect(sample.children[0].text).toBe('A')
  })
})

describe('findNode', () => {
  it('finds the root', () => {
    expect(findNode(sample, 'root')?.text).toBe('Root')
  })
  it('finds a deep descendant', () => {
    expect(findNode(sample, 'a2')?.text).toBe('A2')
  })
  it('returns null when missing', () => {
    expect(findNode(sample, 'zzz')).toBeNull()
  })
})

describe('findParent', () => {
  it('returns null for root', () => {
    expect(findParent(sample, 'root')).toBeNull()
  })
  it('finds the parent of a top-level child', () => {
    expect(findParent(sample, 'a')?.id).toBe('root')
  })
  it('finds the parent of a deep child', () => {
    expect(findParent(sample, 'a1')?.id).toBe('a')
  })
  it('returns null for missing', () => {
    expect(findParent(sample, 'zzz')).toBeNull()
  })
})

describe('removeNode', () => {
  it('removes a top-level child', () => {
    const r = removeNode(sample, 'b')
    expect(r).toBe(true)
    expect(sample.children.find((c) => c.id === 'b')).toBeUndefined()
  })
  it('removes a deep child', () => {
    const r = removeNode(sample, 'a1')
    expect(r).toBe(true)
    expect(sample.children[0].children.find((c) => c.id === 'a1')).toBeUndefined()
  })
  it('returns false for missing', () => {
    expect(removeNode(sample, 'zzz')).toBe(false)
  })
})

describe('addChild', () => {
  it('appends a new child with default text', () => {
    const n = addChild(sample, 'a')
    expect(n).not.toBeNull()
    expect(n?.text).toBe(DEFAULT_NEW_NODE_TEXT)
    expect(sample.children[0].children).toContain(n)
  })
  it('returns null for missing parent', () => {
    expect(addChild(sample, 'zzz')).toBeNull()
  })
  it('uses provided text', () => {
    const n = addChild(sample, 'root', 'hello')
    expect(n?.text).toBe('hello')
  })
})

describe('addSibling', () => {
  it('adds a sibling to a deep node', () => {
    const before = sample.children[0].children.length
    const n = addSibling(sample, 'a1')
    expect(n).not.toBeNull()
    expect(sample.children[0].children.length).toBe(before + 1)
    expect(sample.children[0].children).toContain(n)
  })
  it('returns null for root (no parent)', () => {
    expect(addSibling(sample, 'root')).toBeNull()
  })
  it('regression: inserts the new sibling immediately AFTER the target, not at end of children', () => {
    // sample structure (from the file's top): root → a → [a1, a2], b → [b1].
    // a1 has siblings a2.  addSibling(a1) used to push to the END of
    // a.children (after a2), scrambling order.  After the fix it
    // must slot in at index 1 (between a1 and a2).
    const n = addSibling(sample, 'a1')!
    expect(n).not.toBeNull()
    const ids = sample.children[0].children.map((c) => c.id)
    const idxA1 = ids.indexOf('a1')
    expect(ids[idxA1 + 1]).toBe(n.id)
  })
  it('regression: consecutive addSibling calls each insert after the target, so the most recent lands closest to the target', () => {
    // Start: a.children = [a1, a2].  Add sibling after a1 three
    // times.  addSibling always uses a1 as the anchor and splices at
    // a1's idx+1, so the most recently added node ends up nearest
    // a1.  Result: [a1, s3, s2, s1, a2].  (Smart numbering gives
    // s1=new "新节点", s2="新节点 1", s3="新节点 2" — also tested
    // below.)
    const s1 = addSibling(sample, 'a1')!.id
    const s2 = addSibling(sample, 'a1')!.id
    const s3 = addSibling(sample, 'a1')!.id
    const ids = sample.children[0].children.map((c) => c.id)
    expect(ids).toEqual(['a1', s3, s2, s1, 'a2'])
  })
  it('smart numbers new siblings: 新节点, 新节点 2, 新节点 3, …', () => {
    // Reset a.children to a known shape with no existing "新节点" peers.
    sample.children[0].children = [
      { id: 'a1', text: 'A1', children: [] },
    ]
    // First add: no peers, so plain "新节点".
    expect(addSibling(sample, 'a1')?.text).toBe('新节点')
    // Now a bare "新节点" exists; it occupies slot 1, so the next is "2".
    expect(addSibling(sample, 'a1')?.text).toBe('新节点 2')
    expect(addSibling(sample, 'a1')?.text).toBe('新节点 3')
  })
  it('smart numbers ignore renamed siblings when picking the next number', () => {
    sample.children[0].children = [
      { id: 'a1', text: 'A1', children: [] },
      { id: 'a2', text: 'A2', children: [] }, // renamed, not "新节点"
    ]
    // Renamed siblings don't count.  Same shape as the previous test.
    expect(addSibling(sample, 'a1')?.text).toBe('新节点')
    expect(addSibling(sample, 'a1')?.text).toBe('新节点 2')
  })
})

describe('countDescendants', () => {
  it('counts all descendants of root', () => {
    // a, a1, a2, b, b1 = 5
    expect(countDescendants(sample)).toBe(5)
  })
  it('counts a subtree', () => {
    // a1, a2 = 2
    expect(countDescendants(sample.children[0])).toBe(2)
  })
  it('returns 0 for a leaf', () => {
    expect(countDescendants(sample.children[0].children[0])).toBe(0)
  })
})

describe('addSiblingBefore', () => {
  it('inserts a new sibling before the given node', () => {
    const before = sample.children[0].children.slice()
    const n = addSiblingBefore(sample, 'a1')
    expect(n).not.toBeNull()
    expect(sample.children[0].children[0]).toBe(n) // inserted at index 0
    expect(sample.children[0].children.slice(1)).toEqual(before)
  })
  it('returns null for root (no parent)', () => {
    expect(addSiblingBefore(sample, 'root')).toBeNull()
  })
  it('returns null for missing node', () => {
    expect(addSiblingBefore(sample, 'zzz')).toBeNull()
  })
  it('uses provided text', () => {
    const n = addSiblingBefore(sample, 'a1', 'before-a1')
    expect(n?.text).toBe('before-a1')
  })
})

describe('duplicateNode', () => {
  it('inserts a deep copy after the original', () => {
    const before = sample.children[0].children.length
    const n = duplicateNode(sample, 'a')
    expect(n).not.toBeNull()
    expect(n).not.toBe(sample.children[0]) // new object
    expect(n?.id).not.toBe('a') // new id
    expect(n?.text).toBe('A')
    // children are deep-cloned with new ids
    expect(n?.children.length).toBe(2)
    expect(n?.children[0].id).not.toBe('a1')
    expect(n?.children[0].text).toBe('A1')
    // original was deep-copied (not aliased)
    expect(n?.children[0]).not.toBe(sample.children[0].children[0])
    // root now has one more child (the copy) and 'a' itself is unchanged
    expect(sample.children.length).toBe(3) // [a, copy, b]
    expect(sample.children[0].children.length).toBe(before)
  })
  it('places the copy immediately after the original', () => {
    const n = duplicateNode(sample, 'a')
    expect(sample.children[0].id).toBe('a')
    expect(sample.children[1]).toBe(n) // copy is at index 1
    expect(sample.children[2].id).toBe('b') // original b pushed to index 2
  })
  it('returns null for root', () => {
    expect(duplicateNode(sample, 'root')).toBeNull()
  })
  it('returns null for missing node', () => {
    expect(duplicateNode(sample, 'zzz')).toBeNull()
  })
})

describe('setNodeText', () => {
  it('updates the text of an existing node', () => {
    expect(setNodeText(sample, 'a1', 'A1-renamed')).toBe(true)
    expect(findNode(sample, 'a1')?.text).toBe('A1-renamed')
  })
  it('returns false for missing id and leaves the tree alone', () => {
    expect(setNodeText(sample, 'zzz', 'nope')).toBe(false)
  })
  it('returns false and does nothing for empty / unchanged text', () => {
    expect(setNodeText(sample, 'a1', 'A1')).toBe(false)
  })
})

describe('moveNode', () => {
  it('moves a sibling after a target', () => {
    // a.children = [a1, a2]; b.children = [b1].  Move a1 after b1.
    expect(moveNode(sample, 'a1', 'b1', 'after')).toBe(true)
    expect(sample.children[0].children.map((c) => c.id)).toEqual(['a2'])
    expect(sample.children[1].children.map((c) => c.id)).toEqual(['b1', 'a1'])
  })
  it('moves a sibling before a target', () => {
    // Move a2 before a1.
    expect(moveNode(sample, 'a2', 'a1', 'before')).toBe(true)
    expect(sample.children[0].children.map((c) => c.id)).toEqual(['a2', 'a1'])
  })
  it('moves a node to become a child of the target', () => {
    // Move b1 to be a child of a1.  a1 starts with no children, so
    // a1.children should become ['b1'].
    expect(moveNode(sample, 'b1', 'a1', 'child')).toBe(true)
    expect(sample.children[0].children[0].children.map((c) => c.id)).toEqual(['b1'])
  })
  it('refuses to move the root', () => {
    expect(moveNode(sample, 'root', 'a1', 'child')).toBe(false)
  })
  it('refuses to move a node into its own subtree (cycle)', () => {
    // 'a' is the parent of a1/a2; moving 'a' under a1 would form a
    // cycle.  'a2' is a sibling of a1, NOT a descendant, so this
    // isn't a cycle — only test the actual cycle case.
    expect(moveNode(sample, 'a', 'a1', 'child')).toBe(false)
    // Move 'a' under a2 (also a child of 'a') is also a cycle.
    expect(moveNode(sample, 'a', 'a2', 'child')).toBe(false)
  })
  it('refuses to move a node onto itself', () => {
    expect(moveNode(sample, 'a1', 'a1', 'after')).toBe(false)
  })
})

describe('markdownToMindMap', () => {
  it('builds a tree from heading levels', () => {
    const md = `# Root
## Child A
### Grandchild
## Child B`
    const r = markdownToMindMap(md)
    console.log('final tree:', JSON.stringify(r, (k, v) => k === 'id' ? undefined : v, 2))
    expect(r.text).toBe('Root')
    expect(r.children.map((c) => c.text)).toEqual(['Child A', 'Child B'])
    expect(r.children[0].children[0].text).toBe('Grandchild')
    expect(r.children[1].children).toEqual([])
  })
  it('promotes a body line under a heading to its text', () => {
    const md = `# Topic
- bullet detail
## Sub`
    const r = markdownToMindMap(md)
    expect(r.text).toBe('Topic')
    expect(r.children[0].text).toBe('Sub')
  })
  it('falls back to rootText when no heading is present', () => {
    const r = markdownToMindMap('just some plain text', 'Fallback')
    expect(r.text).toBe('Fallback')
    expect(r.children).toEqual([])
  })
})

describe('markdownToMindMap — inline fields', () => {
  it('parses ![](url) on the line right after a heading as image', () => {
    const md = `## Cover
![banner](https://example.com/banner.png)
## Sibling`
    const r = markdownToMindMap(md)
    expect(r.children[0].text).toBe('Cover')
    expect(r.children[0].image).toBeDefined()
    expect(r.children[0].image!.src).toBe('https://example.com/banner.png')
    // Default size: 160×120 (4:3 fallback when no explicit dims).
    expect(r.children[0].image!.width).toBe(160)
    expect(r.children[0].image!.height).toBe(120)
    // Sibling should NOT inherit the image.
    expect(r.children[1].image).toBeUndefined()
  })

  it('parses [label](url) on the line right after a heading as link, with label as text', () => {
    const md = `## Repo
[GitHub 仓库](https://github.com/xuze/z-mind)
## Next`
    const r = markdownToMindMap(md)
    expect(r.children[0].text).toBe('GitHub 仓库')
    expect(r.children[0].link).toEqual({ url: 'https://github.com/xuze/z-mind' })
    expect(r.children[1].link).toBeUndefined()
  })

  it('parses a ```note … ``` fence right after a heading as note', () => {
    const md = `## Overview
\`\`\`note
hello
world
\`\`\`
## Sibling`
    const r = markdownToMindMap(md)
    expect(r.children[0].text).toBe('Overview')
    expect(r.children[0].note).toBeDefined()
    expect(r.children[0].note!.text).toBe('hello\nworld')
    expect(r.children[1].note).toBeUndefined()
  })

  it('attaches image / link / note to the heading immediately above', () => {
    // Mix of all three, in the "natural" order a user would type.
    const md = `## Card
A short body line.
![pic](https://example.com/p.png)
[Docs](https://example.com/docs)
\`\`\`note
notes about this card
\`\`\`
## Next`
    const r = markdownToMindMap(md)
    const card = r.children[0]
    expect(card.text).toBe('Docs') // link label overrides the heading text
    expect(card.image?.src).toBe('https://example.com/p.png')
    expect(card.link?.url).toBe('https://example.com/docs')
    expect(card.note?.text).toBe('notes about this card')
    // The body line is a separate child of Card.
    expect(card.children.some((c) => c.text === 'A short body line.')).toBe(true)
  })
})

describe('mindMapToMarkdown — round-trip', () => {
  it('preserves image / link / note through a markdown export + re-parse', () => {
    const original: MindMapNode = {
      id: 'root',
      text: 'My Node',
      children: [],
      image: { src: 'https://example.com/p.png', naturalW: 200, naturalH: 150, width: 200, height: 150 },
      link: { url: 'https://example.com' },
      note: { text: 'line 1\nline 2' },
    }
    const md = mindMapToMarkdown(original)
    // Quick visual sanity: the output should contain all three syntaxes.
    expect(md).toContain('![image](https://example.com/p.png)')
    expect(md).toContain('[My Node](https://example.com)')
    expect(md).toContain('```note\nline 1\nline 2\n```')
    // Re-parse and confirm everything is back.
    const reparsed = markdownToMindMap(md)
    expect(reparsed.text).toBe('My Node')
    expect(reparsed.image?.src).toBe('https://example.com/p.png')
    expect(reparsed.link?.url).toBe('https://example.com')
    expect(reparsed.note?.text).toBe('line 1\nline 2')
  })
})
