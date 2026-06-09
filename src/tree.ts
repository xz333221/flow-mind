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

    // Plain prose: append to the current heading's body.  We
    // keep raw line boundaries (joined with '\n') so multi-line
    // bodies round-trip into ` ```note ` fences without losing
    // paragraph breaks.  The body is later attached as the
    // heading's `note` (see pushNode), not as a child node —
    // children would create an extra click target the user
    // didn't ask for; note is the right home for prose that
    // belongs to a heading.
    if (raw.trim().length > 0 && attachTo) {
      const trimmed = raw.trim()
      attachTo.body = attachTo.body ? attachTo.body + '\n' + trimmed : trimmed
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
    if (p.body) {
      // Body prose becomes the heading's note, not a child
      // node — the prose describes the heading rather than
      // being a sibling topic.  mindMapToMarkdown round-trips
      // note as a ```note fence, so this is lossless.  We
      // always attach body (no children-guard needed), because
      // a heading can have both sub-headings AND body prose
      // (the prose belongs to the heading, not to its kids).
      node.note = { text: p.body }
    }
    parent.children.push(node)
    stack.push(node)
    levelStack.push(p.level)
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
  if (n.richContent) s += n.richContent.raw + '\n'
  for (const c of n.children) s += mindMapToMarkdown(c, depth + 1)
  return s
}

// ── rich-content parser ─────────────────────────────────────
//
// `markdownToRichMindMap` is the "document-as-mindmap" twin of
// `markdownToMindMap`.  Where the latter only reads `#`-style
// headings and dumps everything else as a flat body, this one
// walks the whole document and turns EVERY block — heading,
// paragraph, list, code fence, table — into a tree node, with
// the original markdown preserved verbatim in
// `node.richContent.raw` so `mindMapToMarkdown` can round-trip
// it back.
//
// The hierarchy is built by tracking a stack of "active
// containers".  A `#` heading pushes a new container at the
// matching depth (and pops anything shallower so siblings
// flatten).  Plain blocks (paragraphs, lists, code, tables)
// become children of the currently-open heading; if no
// heading has been seen yet, they become children of the
// synthetic root.
//
// The tree is unbounded by design — the user asked for
// "every paragraph becomes a child node, no depth limit".
// Hosts that want a finite view should post-process the
// result (e.g. cap depth, collapse sub-trees).

interface Block {
  /** 'heading' for `#…`, 'code' for fenced, 'list' for `-`/`*`/`1.`, 'table' for `|…|`, 'paragraph' for prose. */
  kind: 'heading' | 'code' | 'list' | 'table' | 'paragraph'
  level?: number         // 1..6 for heading; indent for list; undefined otherwise
  text: string           // for heading: the heading text; for others: a one-line summary used as node title
  raw: string            // original markdown source, multi-line allowed
  lang?: string          // for code: the fence info string
}

function splitBlocks(md: string): Block[] {
  const lines = md.split(/\r?\n/)
  const out: Block[] = []
  let i = 0
  const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/
  const FENCE_RE = /^(`{3,}|~{3,})\s*(\S+)?\s*$/
  const TABLE_SEP_RE = /^\s*\|?\s*(:?-+:?\s*\|\s*)+(:?-+:?)(\s*\|)?\s*$/
  const UL_RE = /^(\s*)[-*+]\s+(.*)$/
  const OL_RE = /^(\s*)\d+\.\s+(.*)$/

  while (i < lines.length) {
    const raw = lines[i]

    // Fenced code block (``` or ~~~).  Body runs until a matching closer.
    const fence = raw.match(FENCE_RE)
    if (fence) {
      const marker = fence[1][0]
      const lang = fence[2] || ''
      const body: string[] = [raw]
      i++
      while (i < lines.length) {
        const closer = lines[i].match(FENCE_RE)
        if (closer && closer[1][0] === marker) {
          body.push(lines[i])
          i++
          break
        }
        body.push(lines[i])
        i++
      }
      const codeText = body.slice(1, -1).join('\n').trim()
      out.push({
        kind: 'code',
        text: codeText.split('\n')[0]?.slice(0, 80) || '(空代码块)',
        raw: body.join('\n'),
        lang,
      })
      continue
    }

    // Heading.
    const h = raw.match(HEADING_RE)
    if (h) {
      out.push({ kind: 'heading', level: h[1].length, text: h[2].trim(), raw: raw })
      i++
      continue
    }

    // Table — contiguous lines starting with `|`.  A separator
    // row (`| --- | --- |`) must appear for the block to count
    // as a table; otherwise the lines fall through to paragraph.
    if (/^\s*\|/.test(raw)) {
      const tblLines: string[] = []
      let j = i
      let sawSep = false
      while (j < lines.length && /^\s*\|/.test(lines[j])) {
        tblLines.push(lines[j])
        if (TABLE_SEP_RE.test(lines[j])) sawSep = true
        j++
      }
      if (sawSep && tblLines.length >= 2) {
        out.push({
          kind: 'table',
          text: tblLines[0].replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|')[0]?.trim() || '表格',
          raw: tblLines.join('\n'),
        })
        i = j
        continue
      }
      // No separator — treat as paragraph so a stray `|` line
      // doesn't get lost.
    }

    // List — `-`, `*`, `+`, or `1.`.  Each non-empty list line
    // becomes its own block so the resulting mindmap can show
    // every list item as a separate node (the user asked for
    // "every paragraph / list item becomes a child, no depth
    // limit").  Blank lines inside a list split it; we don't
    // try to preserve "lists within lists" — each top-level
    // list line is one block with a one-line summary.
    const ul = raw.match(UL_RE)
    const ol = raw.match(OL_RE)
    if (ul || ol) {
      let j = i
      while (j < lines.length) {
        const m1 = lines[j].match(UL_RE)
        const m2 = lines[j].match(OL_RE)
        if (!(m1 || m2)) break
        const cleaned = lines[j]
          .replace(/^\s*[-*+]\s+/, '')
          .replace(/^\s*\d+\.\s+/, '')
          .trim()
        if (cleaned.length > 0) {
          out.push({
            kind: 'list',
            text: cleaned.slice(0, 80) || '(列表项)',
            raw: lines[j],
          })
        }
        j++
      }
      i = j
      continue
    }

    // Blank line — skip; paragraphs are delimited by blank
    // lines below.
    if (raw.trim() === '') { i++; continue }

    // Paragraph — gather until the next blank line / heading /
    // list / table / fence.
    const paraLines: string[] = [raw]
    let j = i + 1
    while (j < lines.length) {
      const peek = lines[j]
      if (peek.trim() === '') break
      if (HEADING_RE.test(peek)) break
      if (FENCE_RE.test(peek)) break
      if (UL_RE.test(peek) || OL_RE.test(peek)) break
      if (/^\s*\|/.test(peek)) break
      paraLines.push(peek)
      j++
    }
    const paraText = paraLines.join(' ').trim()
    out.push({
      kind: 'paragraph',
      text: paraText.slice(0, 80) || '(空段落)',
      raw: paraLines.join('\n'),
    })
    i = j
  }
  return out
}

/**
 * Parse a whole markdown document into a MindMapNode tree where
 * every block (heading, paragraph, list, code fence, table)
 * becomes a node.  Body blocks carry their original markdown
 * payload in `node.richContent` so the renderer can show code,
 * tables, lists, etc. inside the node box.  Headings form the
 * hierarchy; everything else is attached to the most recent
 * heading as a child (or to the synthetic root if no heading
 * has been seen yet).
 *
 * Unlike `markdownToMindMap`, this does NOT collapse body into
 * a single child of the heading, and the depth is unbounded —
 * a paragraph under `## Foo` becomes a child of `Foo`, and a
 * paragraph that follows a list under the same heading becomes
 * a sibling of that list, etc.  This is the mode the user
 * asked for: "every paragraph becomes a child, no depth limit".
 *
 * A document with no `#` heading still produces a valid tree —
 * every block lands under the synthetic root.
 */
export function markdownToRichMindMap(md: string, rootText: string = '导入的导图'): MindMapNode {
  const blocks = splitBlocks(md || '')
  const root: MindMapNode = { id: uid(), text: rootText, children: [] }
  // Container stack.  Bottom is the synthetic root at level 0.
  // Heading pushes a new container at its level (after popping
  // anything >= the same level so headings are siblings of
  // each other at the right tier).
  const stack: MindMapNode[] = [root]
  const levelStack: number[] = [0]
  let firstHeadingPromoted = false

  function attach(block: Block) {
    if (block.kind === 'heading') {
      const lvl = block.level!
      while (stack.length > 1 && levelStack[levelStack.length - 1] >= lvl) {
        stack.pop()
        levelStack.pop()
      }
      // The first level-1 heading in the doc becomes the visible
      // root: mutate the synthetic root in place (text + id) and
      // use it as the new container, so the heading doesn't
      // appear twice (once as root, once as a child of root).
      if (!firstHeadingPromoted && lvl === 1) {
        firstHeadingPromoted = true
        root.text = block.text
        // Keep the original id so the tree is stable across
        // re-parses of the same source.
        // (No need to push a new node — `stack[0]` is already
        // root, and we just bumped its level on the stack so
        // subsequent H2s know they're nested under an H1.)
        levelStack[0] = 1
        return
      }
      const node: MindMapNode = { id: uid(), text: block.text, children: [] }
      stack[stack.length - 1].children.push(node)
      stack.push(node)
      levelStack.push(lvl)
      return
    }
    // Body block — attach to current container.
    const node: MindMapNode = {
      id: uid(),
      text: block.text,
      children: [],
      richContent: { kind: block.kind, raw: block.raw, lang: block.lang },
    }
    stack[stack.length - 1].children.push(node)
  }

  for (const b of blocks) attach(b)
  return root
}

/**
 * Serialize a single node's rich body (if any) back to the
 * original markdown it came from.  Used by `mindMapToMarkdown`
 * to round-trip a tree built by `markdownToRichMindMap`.
 * Returns '' when the node has no rich body.
 */
export function richBlockToMarkdown(n: MindMapNode): string {
  if (!n.richContent) return ''
  return n.richContent.raw + '\n'
}
