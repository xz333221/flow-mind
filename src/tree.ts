import type { MindMapNode, MindMapImage } from './types'

export function uid(): string {
  return 'n_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export function clone<T>(o: T): T {
  // structuredClone throws on Vue's reactive Proxy wrappers, so always use JSON.
  // MindMapNode is a plain JSON shape (id, text, children[]) — no Date/Map/Set/undefined semantics we need to preserve.
  return JSON.parse(JSON.stringify(o)) as T
}

export function findNode(root: MindMapNode, id: string): MindMapNode | null {
  if (root.id === id) return root
  for (const c of root.children) {
    const r = findNode(c, id)
    if (r) return r
  }
  return null
}

export function findParent(
  root: MindMapNode,
  id: string,
  parent: MindMapNode | null = null
): MindMapNode | null {
  if (root.id === id) return parent
  for (const c of root.children) {
    const r = findParent(c, id, root)
    if (r !== null) return r
  }
  return null
}

export function removeNode(root: MindMapNode, id: string): boolean {
  const idx = root.children.findIndex((c) => c.id === id)
  if (idx >= 0) {
    root.children.splice(idx, 1)
    return true
  }
  for (const c of root.children) {
    if (removeNode(c, id)) return true
  }
  return false
}

/** Replace the text of a node by id.  Returns true on success, false
 *  if the node was not found.  No-op on an empty / same string. */
export function setNodeText(root: MindMapNode, id: string, text: string): boolean {
  const n = findNode(root, id)
  if (!n) return false
  if (n.text === text) return false
  n.text = text
  return true
}

/** Position relative to a target node when moving a sibling. */
export type MovePosition = 'before' | 'after' | 'child'

/** Move a node to a new location in the tree.
 *  - 'before' / 'after': insert as a sibling of the target at that slot
 *    (target's parent's children array).
 *  - 'child': insert as the last child of the target.
 *  No-op (returns false) if src === root, or if the move would
 *  create a cycle (i.e. the target lives inside the src subtree, or
 *  src is already in the target's desired position). */
export function moveNode(
  root: MindMapNode,
  srcId: string,
  targetId: string,
  position: MovePosition
): boolean {
  // Refuse root move.  findParent returns null for root.
  if (!findParent(root, srcId)) return false
  if (srcId === targetId) return false
  // Detect cycles: target is inside the src subtree.
  if (findNode(findNode(root, srcId)!, targetId)) return false

  // Detach src from its current parent.
  const srcParent = findParent(root, srcId)!
  const srcIdx = srcParent.children.findIndex((c) => c.id === srcId)
  if (srcIdx < 0) return false
  const [src] = srcParent.children.splice(srcIdx, 1)

  if (position === 'child') {
    const target = findNode(root, targetId)
    if (!target) {
      // Target disappeared — put src back where it was.
      srcParent.children.splice(srcIdx, 0, src)
      return false
    }
    target.children.push(src)
    return true
  }

  // before / after — need a sibling context.
  const targetParent = findParent(root, targetId)
  if (!targetParent) {
    // Target is root?  Root can't have siblings.  Bail and put back.
    srcParent.children.splice(srcIdx, 0, src)
    return false
  }
  let tgtIdx = targetParent.children.findIndex((c) => c.id === targetId)
  if (tgtIdx < 0) {
    srcParent.children.splice(srcIdx, 0, src)
    return false
  }
  if (position === 'after') tgtIdx += 1
  targetParent.children.splice(tgtIdx, 0, src)
  return true
}

function defaultSiblingText(parent: MindMapNode): string {
  // Smart numbering: if the parent's existing children include plain
  // "新节点" or "新节点 N", the next new sibling is "新节点 (N+1)".
  // Renamed children are ignored, so this won't fight with custom
  // text the user has typed.
  //
  // The "next free number" is:
  //   - max(N) + 1  if any "新节点 N" peers exist, OR
  //   - 2            if only a bare "新节点" peer exists (bare is "1"),
  //   - 1            if no "新节点*" peers exist at all.
  // We don't auto-renumber the existing bare node — adding more just
  // gets "1", "2", "3" from then on.  Keeping the first one bare is
  // intentional: it's what the user sees and renaming is one click.
  const re = /^新节点(?:\s+(\d+))?$/
  let max = 0
  let hasUnnumbered = false
  for (const c of parent.children) {
    const m = c.text.match(re)
    if (!m) continue
    if (m[1]) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    } else {
      hasUnnumbered = true
    }
  }
  if (max === 0 && !hasUnnumbered) return DEFAULT_NEW_NODE_TEXT
  // If we have at least one numbered peer, the next is max+1.
  if (max > 0) return `新节点 ${max + 1}`
  // Only a bare "新节点" peer.  It's slot 1; next slot is 2.
  return '新节点 2'
}

export function addChild(
  root: MindMapNode,
  parentId: string,
  text?: string
): MindMapNode | null {
  const p = findNode(root, parentId)
  if (!p) return null
  const node: MindMapNode = { id: uid(), text: text ?? defaultSiblingText(p), children: [] }
  p.children.push(node)
  return node
}

export function addSibling(
  root: MindMapNode,
  nodeId: string,
  text?: string
): MindMapNode | null {
  const parent = findParent(root, nodeId)
  if (!parent) return null
  const idx = parent.children.findIndex((c) => c.id === nodeId)
  if (idx < 0) return null
  const node: MindMapNode = { id: uid(), text: text ?? defaultSiblingText(parent), children: [] }
  // Insert *after* the current node, not at the end of the parent's
  // children list.  Push-to-end would scramble order when adding
  // siblings to nodes that aren't the last child, and would confuse
  // the layout's clockwise sweep.
  parent.children.splice(idx + 1, 0, node)
  return node
}

/**
 * Insert a new sibling node BEFORE the given node (Shift+Enter in xmind).
 * Returns the new node, or null if the target is the root.
 */
export function addSiblingBefore(
  root: MindMapNode,
  nodeId: string,
  text?: string
): MindMapNode | null {
  const parent = findParent(root, nodeId)
  if (!parent) return null
  const idx = parent.children.findIndex((c) => c.id === nodeId)
  if (idx < 0) return null
  const node: MindMapNode = { id: uid(), text: text ?? defaultSiblingText(parent), children: [] }
  parent.children.splice(idx, 0, node)
  return node
}

/**
 * Deep-clone a node (with all its descendants) and insert the copy as a
 * sibling immediately after the original. New ids are generated so the
 * result is a real duplicate. Returns the new node, or null if the
 * target is the root.
 */
export function duplicateNode(root: MindMapNode, nodeId: string): MindMapNode | null {
  const parent = findParent(root, nodeId)
  if (!parent) return null
  const idx = parent.children.findIndex((c) => c.id === nodeId)
  if (idx < 0) return null
  const orig = parent.children[idx]
  const copy = clone(orig)
  reassignIds(copy)
  parent.children.splice(idx + 1, 0, copy)
  return copy
}

function reassignIds(n: MindMapNode) {
  n.id = uid()
  for (const c of n.children) reassignIds(c)
}

export function countDescendants(n: MindMapNode): number {
  return n.children.reduce((acc, c) => acc + 1 + countDescendants(c), 0)
}

export const DEFAULT_NEW_NODE_TEXT = '新节点'

/**
 * Parse a Markdown string into a MindMapNode tree.  Each heading
 * becomes a node; its level sets the depth.
 *   - `# Title`     → root text (overrides `rootText`)
 *   - `## Sub`      → child of the previous #/##/... heading
 *   - bullet / paragraph text between headings → first child
 *     of the preceding heading (so a `# Topic\n- detail` tree
 *     gives one root node with one child).
 *
 * Inline fields parsed from a heading's body (in order, attached
 * to the heading that precedes them):
 *   - `![alt](url)`            → image
 *   - `[label](url)`           → link (label becomes the node's text)
 *   - ` ```note ... ``` `      → note (the fence body becomes note.text)
 *
 * Empty input, or input with no `#` heading, returns a single
 * root with the fallback text.
 */
export function markdownToMindMap(md: string, rootText: string = '导入的导图'): MindMapNode {
  const lines = md.split(/\r?\n/)
  // The stack holds the parent chain.  The bottom is always the
  // synthetic root, so we seed it with a level=-infinity marker
  // (so the first heading never pops it).  `levelStack` is a
  // parallel array of heading levels so pop() can update the
  // comparison value (avoids stale `lastLevel` after a deep-then-
  // shallow sequence like 1→2→3→2).
  const root: MindMapNode = { id: uid(), text: rootText, children: [] }
  const stack: MindMapNode[] = [root]
  const levelStack: number[] = [-Infinity]
  // First pass: walk lines, decide the tree shape and capture
  // each heading's body.  Body lines between two headings are
  // attached to the most recent heading as its first child —
  // a simple `Topic` then `- detail` becomes a one-level deep
  // tree, which mirrors how users actually think about their notes.
  interface Pending {
    level: number
    text: string
    body: string
    image?: MindMapImage
    link?: { url: string }
    note?: { text: string }
  }
  const pending: Pending[] = []
  const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/
  // Markdown image / link: ![alt](url) / [label](url).  Title
  // attribute is optional: `![alt](url "title")`.  We don't need
  // the alt text — only the URL — so the capture group is just
  // the URL inside the parens.
  const IMAGE_RE = /^!\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)\s*$/
  const LINK_RE = /^\[([^\]]+)\]\((\S+?)(?:\s+"[^"]*")?\)\s*$/
  // Fence opener / closer for a special ```note … ``` block.
  // We treat it like a normal markdown fence: must be at column
  // 0 and consist of three-or-more backticks; we only recognise
  // it when the info string is exactly "note".
  const FENCE_RE = /^(`{3,}|~{3,})\s*(\S+)?\s*$/
  // State for an in-flight note fence.
  let inNoteFence = false
  let noteBuffer: string[] = []
  // The pending heading we're currently attaching fields to.  All
  // `image` / `link` / `note` lines between two headings attach
  // here.  Null when we haven't seen a heading yet.
  let attachTo: Pending | null = null

  function consumeNoteFenceLine(raw: string) {
    // Append this line to the active note's text.  Empty line is
    // preserved as a blank; surrounding blank lines are trimmed
    // by the consumer (see `note.text` finalisation below).
    noteBuffer.push(raw)
  }

  function closeNoteFence() {
    if (attachTo && noteBuffer.length > 0) {
      // Strip leading/trailing blank lines so the note doesn't
      // start with a "\n" when the user just typed a one-liner.
      while (noteBuffer.length > 0 && noteBuffer[0].trim() === '') noteBuffer.shift()
      while (noteBuffer.length > 0 && noteBuffer[noteBuffer.length - 1].trim() === '') noteBuffer.pop()
      const text = noteBuffer.join('\n')
      if (text) attachTo.note = { text }
    }
    inNoteFence = false
    noteBuffer = []
  }

  for (const raw of lines) {
    // Inside a note fence: every line goes into the buffer until
    // we see a matching closer.
    if (inNoteFence) {
      const m = raw.match(FENCE_RE)
      if (m && m[1][0] === '`') {
        closeNoteFence()
        continue
      }
      consumeNoteFenceLine(raw)
      continue
    }

    const m = raw.match(HEADING_RE)
    if (m) {
      const level = m[1].length
      const text = m[2].trim()
      pending.push({ level, text, body: '' })
      attachTo = pending[pending.length - 1]
      continue
    }

    // Not a heading.  See if this line opens a ```note fence.
    const fence = raw.match(FENCE_RE)
    if (fence && fence[2] === 'note') {
      inNoteFence = true
      noteBuffer = []
      continue
    }

    // Image?  Link?  Both attach to the most recent heading.
    const img = raw.match(IMAGE_RE)
    if (img && attachTo) {
      const src = img[2]
      // No explicit size in this syntax — fall back to a
      // 4:3 default box.  The renderer can re-probe natural
      // dimensions on first paint; this is just a layout hint.
      const width = 160
      const height = 120
      attachTo.image = { src, naturalW: width, naturalH: height, width, height }
      continue
    }
    const link = raw.match(LINK_RE)
    if (link && attachTo) {
      // Markdown link's label becomes the node's text.  This
      // matches what users expect — "the node *is* the link".
      attachTo.link = { url: link[2] }
      // Override text with the link label if the heading text
      // looks like a placeholder heading (the line right under
      // a heading is usually its body, but when it's a `[…](…)`
      // the label IS the meaningful content).
      attachTo.text = link[1]
      continue
    }

    // Plain prose: append to the current heading's body, which
    // is rendered as the heading's first child node (see
    // `pushNode`).
    if (raw.trim().length > 0 && attachTo) {
      attachTo.body = attachTo.body ? attachTo.body + ' ' + raw.trim() : raw.trim()
    }
  }

  // Close any unterminated note fence gracefully (e.g. user
  // deleted the closing ``` in the editor).
  if (inNoteFence) closeNoteFence()

  function pushNode(p: Pending) {
    // Pop the stack until the top has a level strictly LESS than
    // the new heading's level.  Same-level headings are siblings
    // (the previous `# Heading` shouldn't be popped just because
    // another `# Heading` arrived), and only strictly-deeper
    // headings live under the previous one.  We track levels in
    // a parallel array so pop() can update the comparison value
    // — a deep-then-shallow tree (1→2→3→2) shouldn't flatten
    // because the older `lastLevel=3` lingers.
    while (stack.length > 1) {
      const topIdx = stack.length - 1
      const topLevel = levelStack[topIdx]
      // Strictly less than: when the next heading has the same
      // level as the current top, that heading is the *top's
      // sibling*, not its child — so pop and walk up until we
      // find a strictly shallower parent.
      if (topLevel !== undefined && topLevel < p.level) break
      stack.pop()
      levelStack.pop()
    }
    const parent = stack[stack.length - 1]
    const headingText = p.text
    const node: MindMapNode = { id: uid(), text: headingText, children: [] }
    if (p.image) node.image = { ...p.image }
    if (p.link) node.link = { url: p.link.url }
    if (p.note) node.note = { text: p.note.text }
    if (p.body && pendingHasNoChildren(p, pending, pending.indexOf(p))) {
      node.children.push({ id: uid(), text: p.body, children: [] })
    }
    parent.children.push(node)
    stack.push(node)
    levelStack.push(p.level)
  }

  // Whether `p` has a subsequent heading at a deeper level.  If
  // yes, the body line gets absorbed as a child of that sub-heading
  // instead, so we don't double-render it.
  function pendingHasNoChildren(p: Pending, all: Pending[], idx: number): boolean {
    for (let i = idx + 1; i < all.length; i++) {
      if (all[i].level <= p.level) return true
      if (all[i].level > p.level) return false
    }
    return true
  }

  for (const p of pending) pushNode(p)
  // The synthetic root we seeded stack[0] with never gets a
  // heading pushed into it — pushNode's while-loop protects it
  // (stack.length > 1).  If the document started with a `#`
  // heading, that heading was pushed as the first child.  Promote
  // it to be the visible root: take its children (and id / text).
  if (pending.length > 0 && pending[0].level === 1) {
    const first = root.children[0]
    if (first) {
      root.text = first.text
      root.id = first.id
      // Carry the inline fields up to the promoted root, so a
      // top-level `# Title` with an image still shows the image
      // on the visible root node.
      if (first.image) root.image = { ...first.image }
      if (first.link) root.link = { url: first.link.url }
      if (first.note) root.note = { text: first.note.text }
      root.children = first.children
    }
  }
  return root
}

/**
 * Round-trip-safe Markdown export of a MindMapNode tree.  Each
 * heading is emitted as `#…`, then any inline fields (link /
 * image / note) in a fixed order so the same source produces
 * byte-stable output across re-exports.
 *
 * The `note` field round-trips through a ` ```note ` fence so a
 * user opening the export in any markdown editor sees a clearly
 * labeled block.  The link is emitted as a standard `[label](url)`
 * with the node's text as the label — this keeps the export
 * human-readable and lets `markdownToMindMap` re-attach the
 * link to the right heading.
 */
export function mindMapToMarkdown(n: MindMapNode, depth = 1): string {
  let s = '#'.repeat(depth) + ' ' + (n.text || '') + '\n'
  // Link first so the `[label](url)` line is immediately under
  // the heading — easier to read, and the order matches how a
  // user would type it.
  if (n.link) s += `[${n.text || 'link'}](${n.link.url})\n`
  if (n.image) s += `![image](${n.image.src})\n`
  if (n.note) s += '```note\n' + n.note.text + '\n```\n'
  for (const c of n.children) s += mindMapToMarkdown(c, depth + 1)
  return s
}
