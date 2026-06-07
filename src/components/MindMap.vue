<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onMounted } from 'vue'
import Icon from './Icon.vue'
import { layout, type LayoutNode } from '../core/layout'
import {
  addChild,
  addSibling,
  addSiblingBefore,
  removeNode,
  setNodeText,
  moveNode,
  findNode,
  findParent,
  duplicateNode,
  clone,
  DEFAULT_NEW_NODE_TEXT,
} from '../tree'
import type { MindMapNode, MindMapTheme, MindMapExpose, MindMapSettings, NodeStyle } from '../types' 
import { usePanZoom } from '../composables/usePanZoom'
import { useNodeDrag } from '../composables/useNodeDrag'
import { useKeyboard } from '../composables/useKeyboard'
import { useHistory } from '../composables/useHistory'

const props = withDefaults(
  defineProps<{
    data: MindMapNode
    readonly?: boolean
    theme?: MindMapTheme
    /**
     * When true, hides the MindMap's own toolbar and any UI that
     * isn't strictly the canvas (resize handles, collapse
     * buttons still appear on hover so the user can still
     * interact).  The app-level top toolbar / drawers are
     * controlled by the parent (App.vue) — this only toggles
     * the canvas's own chrome.
     */
    previewMode?: boolean
  }>(),
  { readonly: false, previewMode: false }
)

const emit = defineEmits<{
  (e: 'change', data: MindMapNode): void
  (e: 'select', node: MindMapNode | null): void
}>()

const wrapperRef = ref<HTMLElement | null>(null)
const editingId = ref<string | null>(null)
const editText = ref('')
const selectedId = ref<string | null>(null)
const collapsedIds = ref<Set<string>>(new Set())
const dataRef = ref<MindMapNode>(clone(props.data))
// Debug overlay: sibling-order badge on every node, gated behind
// the showOrderBadge setting (default off — toggled in the
// settings panel).  When on, each rendered node shows a small
// "1./2./3." with its zero-based position in its parent's
// children array, so you can see whether the layout's left/right
// split matches the data-tree order.
const showOrderBadge = computed(() => settings.showOrderBadge === true)
// Per-node style overrides.  Keyed by node id.  Stored in a reactive
// Map (not Vue reactive Map) so .set/.delete work; the template re-
// reads via the ref-of-Map we wrap it in.
const nodeStylesRef = ref<Map<string, NodeStyle>>(new Map())
const nodeStyles = nodeStylesRef.value
function applyNodeStyle(id: string, style: NodeStyle) {
  // shallow copy to keep the public surface pure
  const cleaned: NodeStyle = {}
  if (style.bg) cleaned.bg = style.bg
  if (style.textColor) cleaned.textColor = style.textColor
  if (style.borderColor) cleaned.borderColor = style.borderColor
  if (style.fontWeight) cleaned.fontWeight = style.fontWeight
  if (Object.keys(cleaned).length === 0) {
    nodeStyles.delete(id)
  } else {
    nodeStyles.set(id, cleaned)
  }
  // bump ref so reactive consumers re-render
  nodeStylesRef.value = new Map(nodeStyles)
}
function getNodeStyle(id: string): NodeStyle {
  return nodeStyles.get(id) ?? {}
}
function getNodeStyleOr(id: string, fallback: NodeStyle): NodeStyle {
  return nodeStyles.get(id) ?? fallback
}
const layoutVersion = ref(0)
// Compact layout is the default. The user clicks "balance" to snap
// everything into the balanced layout, undo any manual drag offsets,
// and re-center the view — the layout reverts on the next data change
// unless the caller opts in via setBalanced(true).
const balanced = ref(false)

/** When true, the next layoutResult computed passes
 *  `preservePositions: true` to the layout algorithm, so doLayout
 *  keeps each LayoutNode's existing n.x / n.y instead of re-running
 *  the doLayout step.  Set by the drag-completion path right
 *  before triggering re-layout.  Reset to false by every other
 *  mutation (add child / edit text / etc.) so those code paths
 *  re-run the algorithm and place new / changed nodes. */
const preserveOnNextLayout = ref(false)

/** Undo/redo stack.  Every mutation calls `record()` AFTER applying the
 *  change; undo() / redo() then swap dataRef with a previous snapshot. */
const history = useHistory(100)

/** Snapshot the current tree + node-drag offsets so the next
 *  mutation can be undone.  Tracking offsets is necessary so that
 *  dragging a node is itself a recordable, undoable action. */
function record() {
  history.record({
    data: dataRef.value,
    offsets: nodeDrag.getOffsets(),
  })
}

/** Apply a new tree, push to emit, refresh layout.  Used by mutations
 *  and by undo/redo (where the tree already came from history). */
function applyData(next: MindMapNode, opts: { resetCollapsed?: boolean; resetSelection?: boolean } = {}) {
  dataRef.value = clone(next)
  if (opts.resetCollapsed) collapsedIds.value = new Set()
  if (opts.resetSelection) {
    selectedId.value = null
    emit('select', null)
  }
  triggerRef()
  emit('change', dataRef.value)
}

function triggerRef() {
  collapsedIds.value = new Set(collapsedIds.value)
  layoutVersion.value++
  // layoutResult now decides for itself whether to preservePositions
  // (see `preserveOnNextLayout`).  The drag-completion callback
  // sets that flag before calling us, so we don't need to do
  // anything special here — just bump the version.  In the
  // `else` branch of layoutResult we still call nodeDrag.resetOffsets()
  // for the non-drag code paths (addChild / edit / setNodeText /
  // collapse-toggle / etc.) so stale offsets don't linger.
  if (settings.autoBalanceOnChange && !props.readonly) {
    nextTick(() => {
      balanced.value = true
      // Re-run the layout computed (the `preserve` flag is already
      // set in the drag case, false otherwise).  Then re-center
      // the view on it.
      nextTick(() => resetView())
    })
  }
}

const theme = computed<Required<MindMapTheme>>(() => ({
  rootBg: props.theme?.rootBg ?? '#1f2937',
  rootText: props.theme?.rootText ?? '#ffffff',
  branchBg: props.theme?.branchBg ?? '#ffffff',
  branchText: props.theme?.branchText ?? '#1f2937',
  lineColor: props.theme?.lineColor ?? '#94a3b8',
  bgColor: props.theme?.bgColor ?? '#f8fafc',
  fontSize: props.theme?.fontSize ?? 14,
  lineWidthStart: props.theme?.lineWidthStart ?? 2.2,
  lineWidthEnd: props.theme?.lineWidthEnd ?? 0.8,
  rainbowBranch: props.theme?.rainbowBranch ?? false,
}))

// ---------------------------------------------------------------------------
// User-controllable settings (settings panel / applySettings)
// ---------------------------------------------------------------------------
const settings = reactive<MindMapSettings>({
  autoBalanceOnChange: true,
  lineWidthStart: 12.0,
  lineWidthEnd: 3.6,
  rainbowBranch: true,
  lineStyle: 'curve',
  layoutMode: 'mindmap',
  taperedEdge: true,
  showOrderBadge: false,
})

// Two width strategies, selected by `settings.taperedEdge`:
//
// (a) tapered (default, true): each edge tapers INDEPENDENTLY.  Its
//     parent-end width is a per-tier function of the parent's depth
//     (root=start, level-1=0.67×start, level-2=0.42×start, leaf=end),
//     and its child-end width is the global `lineWidthEnd`.  Visually
//     you get discrete ribbons — a level-2 edge can be THICKER at the
//     parent side than a level-1 edge is at the child side.
//
// (b) continuous (false): the whole tree forms a single tapered band
//     from `lineWidthStart` at the root to `lineWidthEnd` at the
//     leaves.  The parent-end of every edge is the same width as the
//     child-end of the edge that landed on that node, so widths
//     interpolate smoothly.
function lineWidthForDepth(depth: number): number {
  return settings.taperedEdge
    ? taperedParentWidth(depth)
    : continuousWidth(depth)
}
function endWidthForDepth(depth: number): number {
  return settings.taperedEdge
    ? settings.lineWidthEnd
    : continuousWidth(depth)
}
function taperedParentWidth(depth: number): number {
  // Per-tier parent-side width.  The child side is always
  // `lineWidthEnd` (set by endWidthForDepth above).
  if (depth <= 0) return settings.lineWidthStart
  if (depth === 1) return Math.max(1.5, settings.lineWidthStart * 0.67)
  if (depth === 2) return Math.max(0.8, settings.lineWidthStart * 0.42)
  return settings.lineWidthEnd
}
function continuousWidth(depth: number): number {
  // depth 0 = root → start; depth >= 3 = leaf → end; in between
  // interpolate.  Mirror the preview math in SettingsPanel.vue.
  if (depth <= 0) return settings.lineWidthStart
  if (depth >= 3) return settings.lineWidthEnd
  const t = depth / 3
  return settings.lineWidthStart + (settings.lineWidthEnd - settings.lineWidthStart) * t
}

/** Cubic Bezier point at parameter t in [0,1].  P0=P(from),
 *  P1=(x1,y1), P2=(x2,y2), P3=P(to). */
function cubicAt(
  t: number,
  from: { x: number; y: number },
  c: { x1: number; y1: number; x2: number; y2: number },
  to: { x: number; y: number }
) {
  const u = 1 - t
  const x = u * u * u * from.x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * to.x
  const y = u * u * u * from.y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * to.y
  return { x, y }
}

/** Build a single closed-fill SVG path that visually represents the
 *  cubic Bezier from `from` to `to` with a stroke width that tapers
 *  linearly from `startW` (parent end, thick) to `endW` (child end,
 *  thin).  32 samples along the curve, offset along the normal, give
 *  a smooth filled ribbon — restores the "粗端(根部) 细端(子端)"
 *  taper that the simple-stroke bezier was missing.
 *
 *  For 'down' (org mode) the control points sit on the parent/child
 *  x line, offset on y by 45% of the gap (1.html parity). */
function variableWidthPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  startW: number,
  endW: number,
  n = 32,
  style: 'curve' | 'straight' = 'curve',
  dir: 'right' | 'left' | 'down' = 'right'
): string {
  if (style === 'curve') {
    let c: { x1: number; y1: number; x2: number; y2: number }
    if (dir === 'right' || dir === 'left') {
      // 1.html: control points sit on the parent/child y line,
      // offset on x by 45% of the gap.  This gives the long
      // horizontal "fish gill" look.
      const dx = Math.abs(to.x - from.x)
      const cpx = dx * 0.45
      const sign = dir === 'right' ? 1 : -1
      c = { x1: from.x + sign * cpx, y1: from.y, x2: to.x - sign * cpx, y2: to.y }
    } else {
      // 'down' — vertical control points (45% of the y gap).
      const dy = Math.abs(to.y - from.y)
      const cpy = dy * 0.45
      c = { x1: from.x, y1: from.y + cpy, x2: to.x, y2: to.y - cpy }
    }
    const deriv = (t: number) => {
      const u = 1 - t
      const dx2 = -3 * u * u * from.x + 3 * (u * u - 2 * u * t) * c.x1 + 3 * (2 * u * t - t * t) * c.x2 + 3 * t * t * to.x
      const dy2 = -3 * u * u * from.y + 3 * (u * u - 2 * u * t) * c.y1 + 3 * (2 * u * t - t * t) * c.y2 + 3 * t * t * to.y
      return { dx: dx2, dy: dy2 }
    }
    const left: { x: number; y: number }[] = []
    const right: { x: number; y: number }[] = []
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const p = i === 0 ? from : i === n ? to : cubicAt(t, from, c, to)
      const d = deriv(t)
      let dlen = Math.hypot(d.dx, d.dy)
      if (dlen < 1e-6) dlen = 1
      const nxn = -d.dy / dlen
      const nyn = d.dx / dlen
      const halfW = (startW + (endW - startW) * t) / 2
      left.push({ x: p.x + nxn * halfW, y: p.y + nyn * halfW })
      right.push({ x: p.x - nxn * halfW, y: p.y - nyn * halfW })
    }
    let d2 = `M ${left[0].x.toFixed(2)} ${left[0].y.toFixed(2)}`
    for (let i = 1; i <= n; i++) d2 += ` L ${left[i].x.toFixed(2)} ${left[i].y.toFixed(2)}`
    for (let i = n; i >= 0; i--) d2 += ` L ${right[i].x.toFixed(2)} ${right[i].y.toFixed(2)}`
    d2 += ' Z'
    return d2
  }

  // 'straight' fallback: a simple quad with no curve at all.
  const dx = to.x - from.x
  const dy = to.y - from.y
  let len = Math.hypot(dx, dy)
  if (len < 1e-6) len = 1
  const nx = -dy / len
  const ny = dx / len
  const halfStart = startW / 2
  const halfEnd = endW / 2
  const a = { x: from.x + nx * halfStart, y: from.y + ny * halfStart }
  const b = { x: from.x - nx * halfStart, y: from.y - ny * halfStart }
  const c = { x: to.x - nx * halfEnd, y: to.y - ny * halfEnd }
  const d = { x: to.x + nx * halfEnd, y: to.y + ny * halfEnd }
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${d.x.toFixed(2)} ${d.y.toFixed(2)} L ${c.x.toFixed(2)} ${c.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)} Z`
}

const lrRootChildren = computed<LayoutNode[]>(() => layoutResult.value.root.children)
// (intentionally no rootEdgeAnchor — 1.html uses simple rect-edge
// midpoints.  The fan geometry is in the bezier control points.)

const RAINBOW = [
  '#f87171', '#fb923c', '#fbbf24', '#a3e635',
  '#34d399', '#22d3ee', '#818cf8', '#c084fc',
]

const branchColor = computed<Map<string, string>>(() => {
  const m = new Map<string, string>()
  if (!settings.rainbowBranch) return m
  for (let i = 0; i < lrRootChildren.value.length; i++) {
    const c = lrRootChildren.value[i]
    m.set(c.id, RAINBOW[i % RAINBOW.length])
  }
  const walk = (n: LayoutNode, hue: string) => {
    m.set(n.id, hue)
    for (const c of n.children) walk(c, hue)
  }
  for (let i = 0; i < lrRootChildren.value.length; i++) {
    const c = lrRootChildren.value[i]
    walk(c, RAINBOW[i % RAINBOW.length])
  }
  return m
})

function lineColorFor(_parent: LayoutNode, child: LayoutNode): string {
  if (settings.rainbowBranch) {
    return branchColor.value.get(child.id) ?? theme.value.lineColor
  }
  return theme.value.lineColor
}

function nodeBg(n: LayoutNode): string {
  const s = getNodeStyle(n.id)
  if (s.bg) return s.bg
  if (n.isRoot) return theme.value.rootBg
  if (settings.rainbowBranch) {
    const hue = branchColor.value.get(n.id)
    if (hue) return hexWithAlpha(hue, 0.18)
  }
  return theme.value.branchBg
}
function nodeFg(n: LayoutNode): string {
  const s = getNodeStyle(n.id)
  if (s.textColor) return s.textColor
  if (n.isRoot) return theme.value.rootText
  if (settings.rainbowBranch) {
    const hue = branchColor.value.get(n.id)
    if (hue) return darken(hue, 0.55)
  }
  return theme.value.branchText
}
function nodeBorder(n: LayoutNode): string {
  const s = getNodeStyle(n.id)
  if (s.borderColor) return s.borderColor
  if (n.isRoot) return theme.value.rootBg
  if (settings.rainbowBranch) {
    const hue = branchColor.value.get(n.id)
    if (hue) return darken(hue, 0.3)
  }
  return theme.value.lineColor
}
function nodeFontWeight(n: LayoutNode): number {
  const s = getNodeStyle(n.id)
  return s.fontWeight ?? (n.isRoot ? 600 : 400)
}

function hexWithAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 6 ? h : h.split('').map((c) => c + c).join('')
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function darken(hex: string, amount: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 6 ? h : h.split('').map((c) => c + c).join('')
  const r = Math.round(parseInt(full.slice(0, 2), 16) * (1 - amount))
  const g = Math.round(parseInt(full.slice(2, 4), 16) * (1 - amount))
  const b = Math.round(parseInt(full.slice(4, 6), 16) * (1 - amount))
  return `rgb(${r}, ${g}, ${b})`
}

// pan / zoom
const panZoom = usePanZoom({ getContainer: () => wrapperRef.value })
panZoom.setOnMarqueeEnd(onMarqueeEnd)

// node drag — collectDescendants and getNodeById need access to allNodes
const allNodesComputed = ref<LayoutNode[]>([])
const nodesByIdComputed = ref<Map<string, LayoutNode>>(new Map())
const allNodes = computed<LayoutNode[]>(() => {
  // touch layoutVersion so updates propagate
  void layoutVersion.value
  return allNodesComputed.value
})
const nodesById = computed(() => {
  void layoutVersion.value
  return nodesByIdComputed.value
})
function collectDescendants(rootId: string): string[] {
  const out: string[] = []
  const walk = (n: LayoutNode) => {
    for (const c of n.children) {
      out.push(c.id)
      walk(c)
    }
  }
  const root = nodesById.value.get(rootId)
  if (root) walk(root)
  return out
}
const nodeDrag = useNodeDrag({
  scale: panZoom.scale,
  getNodeById: (id) => nodesById.value.get(id),
  collectDescendants,
  onChange: () => {
    // Drag commits the offset permanently into the data tree's
    // `_x` / `_y` and re-runs the layout with
    // `preservePositions: true`, so the dragged subtree stays
    // where the user put it.  The commit + layout pass runs in
    // the next layoutResult computed tick (it reads
    // `preserveOnNextLayout` and acts on it).
    //
    // record() is called BEFORE the commit so undo restores the
    // pre-drag snapshot.
    record()
    preserveOnNextLayout.value = true
    triggerRef()
    // autoBalance path: re-center the view after the new layout
    // settles so the user sees the dragged result.  We drive
    // autoBalance here directly (rather than relying on
    // triggerRef's autoBalance branch) because the layout pass
    // must read preserveOnNextLayout BEFORE we clear it — the
    // autoBalance branch in triggerRef would re-run layout
    // without the flag and undo our commit.
    if (settings.autoBalanceOnChange && !props.readonly) {
      nextTick(() => nextTick(() => resetView()))
    }
  },
})

// keyboard
useKeyboard({
  isEditing: () => editingId.value !== null,
  isReadonly: () => props.readonly,
  getSelectedId: () => selectedId.value,
  getRootId: () => dataRef.value.id,
  // If nothing is selected, default Tab/Enter to the root so the user
  // can build a tree from scratch without first clicking somewhere.
  defaultTargetId: () => dataRef.value.id,
  onAddChild: doAddChild,
  onAddSibling: doAddSibling,
  onAddSiblingBefore: doAddSiblingBefore,
  onRemove: doRemove,
  onStartEdit: startEdit,
  onClearSelection: () => {
    selectedId.value = null
    emit('select', null)
  },
  onDuplicate: doDuplicate,
  onUndo: doUndo,
  onRedo: doRedo,
  onNavigate: doNavigate,
  onSelectRoot: () => {
    selectedId.value = dataRef.value.id
    const n = findNode(dataRef.value, dataRef.value.id)
    if (n) emit('select', n)
  },
})

// layout
const layoutResult = computed(() => {
  // The drag-completion path sets `preserveOnNextLayout = true` to
  // tell the layout algorithm to keep n.x / n.y instead of recomputing
  // them.  We also need to commit the per-node drag offsets into
  // the data tree BEFORE cloning, so the preserved n.x / n.y
  // includes the dragged position.  Once committed, clear the
  // offset map so subsequent moves don't double-count.
  const preserve = preserveOnNextLayout.value
  if (preserve) {
    commitDragOffsetsToData()
  } else {
    // Always clear offsets on a non-preserved re-run: the data
    // tree changed, so any leftover offsets are now misleading.
    nodeDrag.resetOffsets()
  }
  preserveOnNextLayout.value = false
  const data = clone(dataRef.value)
  applyCollapse(data)
  const r = layout(data, {
    mode: settings.layoutMode,
    preservePositions: preserve,
  })
  return r
})

/** Walk the per-node drag offsets and stamp them into the data
 *  tree as `_x` / `_y` so the next layout pass (with
 *  `preservePositions: true`) keeps the node at the dragged
 *  spot.  Also walks the descendants so an entire subtree moves
 *  together (preserves the "drag with me" relationship).  Clears
 *  the offset map afterwards. */
function commitDragOffsetsToData() {
  const root = dataRef.value
  const offsets = nodeDrag.getOffsets()
  const apply = (n: MindMapNode, dx: number, dy: number) => {
    n._x = (n._x ?? 0) + dx
    n._y = (n._y ?? 0) + dy
    for (const c of n.children) apply(c, dx, dy)
  }
  for (const id in offsets) {
    const o = offsets[id]
    if (!o || (o.x === 0 && o.y === 0)) continue
    const n = findNode(root, id)
    if (!n) continue
    apply(n, o.x, o.y)
  }
  nodeDrag.resetOffsets()
}

// Walk the layout in one pass, building both the flat node list and the lookup map
watch(
  layoutResult,
  (r) => {
    const list: LayoutNode[] = []
    const map = new Map<string, LayoutNode>()
    const walk = (n: LayoutNode) => {
      list.push(n)
      map.set(n.id, n)
      for (const c of n.children) walk(c)
    }
    walk(r.root)
    allNodesComputed.value = list
    nodesByIdComputed.value = map
  },
  { immediate: true }
)

const edges = computed(() => {
  const out: { from: LayoutNode; to: LayoutNode; key: string }[] = []
  for (const n of allNodes.value) {
    for (const c of n.children) {
      out.push({ from: n, to: c, key: `${n.id}->${c.id}` })
    }
  }
  return out
})

const viewBox = computed(
  () =>
    `${layoutResult.value.vbX} ${layoutResult.value.vbY} ${layoutResult.value.vbW} ${layoutResult.value.vbH}`
)

function applyCollapse(n: MindMapNode) {
  if (collapsedIds.value.has(n.id)) {
    n.children = []
    n.collapsed = true
    return
  }
  n.collapsed = false
  for (const c of n.children) applyCollapse(c)
}

function startEdit(id: string) {
  const n = findNode(dataRef.value, id)
  if (!n) return
  editingId.value = id
  editText.value = n.text
  // The input is mounted conditionally; once it appears we have to focus
  // it ourselves.  Use nextTick so the v-else branch has rendered.
  nextTick(() => {
    const el = document.querySelector('.zm-input') as HTMLInputElement | null
    el?.focus()
    el?.select()
  })
}

function commitEdit(opts: { addSibling?: 'after' | 'before'; addChild?: boolean } = {}) {
  if (!editingId.value) return
  const n = findNode(dataRef.value, editingId.value)
  if (n && n.text !== (editText.value.trim() || ' ')) {
    n.text = editText.value.trim() || ' '
    record()
    emit('change', dataRef.value)
  }
  const id = editingId.value
  editingId.value = null
  // After committing, optionally add a new node in the same pass.
  // This matches xmind: pressing Enter while editing commits the text
  // AND creates a fresh sibling ready to type into.  Tab while editing
  // commits and creates a child of the same node.
  if (opts.addChild) {
    nextTick(() => doAddChild(id))
  } else if (opts.addSibling === 'after') {
    nextTick(() => doAddSibling(id))
  } else if (opts.addSibling === 'before') {
    nextTick(() => doAddSiblingBefore(id))
  }
}

function cancelEdit() {
  editingId.value = null
}

function onEditKeydown(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey
  if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
    e.preventDefault()
    doUndo()
  } else if (
    (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
    (mod && (e.key === 'y' || e.key === 'Y') && !e.shiftKey)
  ) {
    e.preventDefault()
    doRedo()
  }
}

function doAddChild(parentId: string) {
  const n = addChild(dataRef.value, parentId, DEFAULT_NEW_NODE_TEXT)
  if (n) {
    record()
    triggerRef()
    emit('change', dataRef.value)
    nextTick(() => startEdit(n.id))
  }
}

function doAddSibling(nodeId: string) {
  if (nodeId === dataRef.value.id) {
    doAddChild(nodeId)
    return
  }
  const n = addSibling(dataRef.value, nodeId, DEFAULT_NEW_NODE_TEXT)
  if (n) {
    record()
    triggerRef()
    emit('change', dataRef.value)
    nextTick(() => startEdit(n.id))
  }
}

function doAddSiblingBefore(nodeId: string) {
  // root has no siblings to insert before — fall back to addChild
  if (nodeId === dataRef.value.id) {
    doAddChild(nodeId)
    return
  }
  const n = addSiblingBefore(dataRef.value, nodeId, DEFAULT_NEW_NODE_TEXT)
  if (n) {
    record()
    triggerRef()
    emit('change', dataRef.value)
    nextTick(() => startEdit(n.id))
  }
}

function doDuplicate(nodeId: string) {
  if (nodeId === dataRef.value.id) return
  const n = duplicateNode(dataRef.value, nodeId)
  if (n) {
    record()
    selectedId.value = n.id
    emit('change', dataRef.value)
    triggerRef()
  }
}

function doUndo() {
  const restored = history.undo()
  if (restored) {
    dataRef.value = restored.data
    nodeDrag.setOffsets(restored.offsets)
    selectedId.value = null
    emit('select', null)
    triggerRef()
    emit('change', dataRef.value)
  }
}

function doRedo() {
  const restored = history.redo()
  if (restored) {
    dataRef.value = restored.data
    nodeDrag.setOffsets(restored.offsets)
    selectedId.value = null
    emit('select', null)
    triggerRef()
    emit('change', dataRef.value)
  }
}

function doNavigate(dx: number, dy: number) {
  const cur = selectedId.value ?? dataRef.value.id
  const node = findNode(dataRef.value, cur)
  if (!node) return
  let nextId: string | null = null
  if (dy === +1) {
    // next sibling
    const p = findParent(dataRef.value, node.id)
    if (p) {
      const i = p.children.findIndex((c) => c.id === node.id)
      if (i >= 0 && i < p.children.length - 1) nextId = p.children[i + 1].id
    }
  } else if (dy === -1) {
    // previous sibling
    const p = findParent(dataRef.value, node.id)
    if (p) {
      const i = p.children.findIndex((c) => c.id === node.id)
      if (i > 0) nextId = p.children[i - 1].id
    }
  } else if (dx === +1) {
    // parent (up the tree)
    const p = findParent(dataRef.value, node.id)
    if (p) nextId = p.id
  } else if (dx === -1) {
    // first child
    if (node.children.length > 0) nextId = node.children[0].id
  }
  if (nextId) {
    selectedId.value = nextId
    const next = findNode(dataRef.value, nextId)
    if (next) emit('select', next)
  }
}

function doRemove(nodeId: string) {
  if (nodeId === dataRef.value.id) return
  if (removeNode(dataRef.value, nodeId)) {
    record()
    if (selectedId.value === nodeId) selectedId.value = null
    triggerRef()
    emit('change', dataRef.value)
  }
}

function toggleCollapse(id: string) {
  if (collapsedIds.value.has(id)) collapsedIds.value.delete(id)
  else collapsedIds.value.add(id)
  triggerRef()
}

/** External edit hook (used by the outline panel's inline edit).
 *  No-op if the text is unchanged or the id doesn't exist. */
function doSetText(id: string, text: string) {
  if (setNodeText(dataRef.value, id, text)) {
    record()
    triggerRef()
    emit('change', dataRef.value)
  }
}

/** External move hook (used by the outline panel's drag-and-drop).
 *  position: 'before' / 'after' / 'child'.  Returns true on success. */
function doMove(srcId: string, targetId: string, position: 'before' | 'after' | 'child'): boolean {
  if (moveNode(dataRef.value, srcId, targetId, position)) {
    record()
    triggerRef()
    emit('change', dataRef.value)
    return true
  }
  return false
}

function onNodeClick(e: MouseEvent, n: LayoutNode) {
  e.stopPropagation()
  selectedId.value = n.id
  const data = findNode(dataRef.value, n.id)
  emit('select', data)
}

/** Click on the canvas background (not on a node) — clear the
 *  current selection and tell the parent. */
function onCanvasMouseDown(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (!target) return
  // Don't start a canvas-level gesture when the press lands on a
  // node, the toolbar, or any control button — those have their
  // own handlers (drag-node, button click, etc).
  if (target.closest('.zm-node, .zm-toolbar, button, input, textarea')) return
  if (e.button === 2) {
    // Right button: pan the canvas.
    panZoom.startPan(e)
    return
  }
  if (e.button !== 0) return
  // Left button: start a marquee (rectangle selection) anchored
  // at the press point. Convert screen → world coords through the
  // current scale / offset.
  const rect = wrapperRef.value!.getBoundingClientRect()
  const wx = (e.clientX - rect.left - panZoom.offsetX.value) / panZoom.scale.value
  const wy = (e.clientY - rect.top - panZoom.offsetY.value) / panZoom.scale.value
  panZoom.startMarquee(wx, wy)
}

function onCanvasClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (!target) return
  // Ignore clicks that land on a node or its control buttons.
  if (target.closest('.zm-node')) return
  // If a marquee just finished (drag was wide enough to count as
  // a real selection gesture), keep whatever the marquee picked.
  // Only treat a *tiny* marquee — i.e. a click with no real drag —
  // as a deselect.
  const m = panZoom.marquee
  if (m.width >= 4 || m.height >= 4) return
  if (selectedId.value !== null) {
    selectedId.value = null
    emit('select', null)
  }
}

// When a marquee ends, intersect the marquee rectangle with
// every node's world-space bbox and select all that overlap.
function onMarqueeEnd() {
  const m = panZoom.marquee
  if (m.width < 4 && m.height < 4) {
    // Treat tiny drags as a click — fall through to onCanvasClick.
    return
  }
  // Compute marquee corners.
  const x1 = m.x
  const y1 = m.y
  const x2 = m.x + m.width
  const y2 = m.y + m.height
  const hit: string[] = []
  for (const n of allNodes.value) {
    const halfW = n.width / 2
    const halfH = n.height / 2
    // AABB intersect: a node is hit if its bbox overlaps the
    // marquee in BOTH axes.  Standard AABB intersection check, so
    // partially-encroached nodes (the common case) are also
    // selected.
    const nLeft = n.x - halfW
    const nRight = n.x + halfW
    const nTop = n.y - halfH
    const nBottom = n.y + halfH
    const overlaps =
      nLeft <= x2 && nRight >= x1 && nTop <= y2 && nBottom >= y1
    if (overlaps) hit.push(n.id)
  }
  if (hit.length > 0) {
    // Pick the first hit as the primary selection; downstream code
    // can use the array via emitted 'select'.
    selectedId.value = hit[0]
    const data = findNode(dataRef.value, hit[0])
    if (data) emit('select', data)
  }
}

function isCollapsed(id: string) {
  return collapsedIds.value.has(id)
}

function nodeHasChildren(n: LayoutNode) {
  const data = findNode(dataRef.value, n.id)
  return !!data && data.children.length > 0
}

/** How many direct children a collapsed node is hiding.  Reads from
 *  the original data tree (the layout tree's `n.children` is empty
 *  for a collapsed node, so it would always be 0).  Returns 0 if
 *  the node doesn't exist or has no children, so callers can use
 *  the result as a v-if guard. */
function collapsedChildCount(id: string): number {
  const data = findNode(dataRef.value, id)
  if (!data) return 0
  return data.children.length
}

/** Zero-based index of the node in its parent's children array.
 *  Returns 0 for the root (no parent).  Used by the order badge
 *  to label each rendered node with its data-tree position. */
function siblingIndexOf(id: string): number {
  const data = findNode(dataRef.value, id)
  if (!data) return 0
  // findNode doesn't return the parent; walk again to find it.
  const root = dataRef.value
  const stack: MindMapNode[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    const idx = n.children.findIndex((c) => c.id === id)
    if (idx >= 0) return idx
    for (const c of n.children) stack.push(c)
  }
  return 0
}

// =====================================================================
// Edge anchor — 1.html JS L608-626.  For horizontal children (right or
// left), the line lands on the side mid-edge of the parent and child.
// For 'down' (org mode), it lands on the top/bottom mid-edge.  No fan
// geometry on the root — the previous `rootEdgeAnchor` ray-cast is
// gone; 1.html just uses the rect-edge midpoint and lets the bezier
// control points do the smoothing.
// =====================================================================
function lineAnchor(
  n: LayoutNode,
  side: 'in' | 'out',
  dir?: 1 | -1,
  child?: LayoutNode
): { x: number; y: number } {
  const p = nodeDrag.nodePos(n)
  const childDir = child?._dir ?? n._dir
  if (childDir === 'down') {
    // Vertical layout (org mode): line lands on top/bottom mid-edge
    if (side === 'out') return { x: p.x, y: p.y + n.height / 2 }
    return { x: p.x, y: p.y - n.height / 2 }
  }
  // Horizontal (mindmap / tree): line lands on left/right mid-edge
  let d: 1 | -1
  if (side === 'in') d = (-n.side) as 1 | -1
  else if (dir !== undefined) d = dir
  else d = n.side
  return { x: p.x + d * (n.width / 2), y: p.y }
}

function resetView() {
  const r = layoutResult.value
  panZoom.resetView(r.width, r.height, r.root.y)
}

function runBalance() {
  // 1. clear all manual drag offsets so dragged nodes return to the
  //    algorithm-defined position
  nodeDrag.resetOffsets()
  // 2. apply balanced layout (re-runs the layout computed with
  //    { balanced: true })
  balanced.value = true
  // 3. record this so Ctrl+Z can restore the pre-balance state
  record()
  // 3. force a layoutVersion bump so the computed re-runs immediately
  triggerRef()
  // 4. re-center the view so the user sees the result
  nextTick(() => resetView())
}

// 1.html-style layout mode switcher.  Changes settings.layoutMode
// and re-runs the layout.  Triggering nextTick+resetView is the
// same dance runBalance() does.
function setLayoutMode(mode: 'mindmap' | 'tree' | 'org') {
  if (settings.layoutMode === mode) return
  settings.layoutMode = mode
  triggerRef()
  nextTick(() => resetView())
}

function exportData(): string {
  return JSON.stringify(dataRef.value, null, 2)
}

function importData(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as MindMapNode
    if (!parsed.id || !Array.isArray(parsed.children)) return false
    history.reset()
    dataRef.value = clone(parsed)
    selectedId.value = null
    collapsedIds.value = new Set()
    nodeDrag.resetOffsets()
    triggerRef()
    nextTick(() => resetView())
    emit('change', dataRef.value)
    return true
  } catch {
    return false
  }
}

function importFromFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json'
  input.onchange = () => {
    const f = input.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        if (!importData(reader.result)) alert('导入失败:JSON 格式无效')
      }
    }
    reader.readAsText(f)
  }
  input.click()
}

function exportToFile() {
  const blob = new Blob([exportData()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${dataRef.value.text || 'mindmap'}.json`
  a.click()
  URL.revokeObjectURL(url)
}

defineExpose<MindMapExpose>({
  addChild: (parentId: string) => doAddChild(parentId),
  addSibling: (nodeId: string) => doAddSibling(nodeId),
  removeNode: (nodeId: string) => doRemove(nodeId),
  duplicateNode: (nodeId: string) => doDuplicate(nodeId),
  setNodeText: (nodeId: string, text: string) => doSetText(nodeId, text),
  moveNode: (srcId: string, targetId: string, position: 'before' | 'after' | 'child') =>
    doMove(srcId, targetId, position),
  lineWidthForDepth,
  endWidthForDepth,
  getData: () => dataRef.value,
  setData: (d) => {
    history.reset()
    dataRef.value = clone(d)
    selectedId.value = null
    collapsedIds.value = new Set()
    nodeDrag.resetOffsets()
    triggerRef()
    nextTick(() => resetView())
  },
  resetView: () => resetView(),
  exportData,
  importData,
  // Make balanced the active layout (sticky).  Subsequent data changes
  // and additions stay in balanced mode.  Pass `false` to revert to the
  // default compact layout.
  setBalanced: (v: boolean) => {
    balanced.value = v
  },
  isBalanced: () => balanced.value,
  // Re-balance now: clear all manual drag offsets, re-run the balanced
  // layout, and re-center the view.  This is the action tied to the
  // "balance" toolbar button.
  balance: () => runBalance(),
  applyNodeStyle: (id: string, style: NodeStyle) => applyNodeStyle(id, style),
  getNodeStyle: (id: string): NodeStyle => getNodeStyle(id),
  undo: () => doUndo(),
  redo: () => doRedo(),
  canUndo: () => history.canUndo(),
  canRedo: () => history.canRedo(),
  // Settings panel / external mutation hooks
  applySettings: (s: Partial<MindMapSettings>) => {
    if (s.autoBalanceOnChange !== undefined) settings.autoBalanceOnChange = s.autoBalanceOnChange
    if (s.lineWidthStart !== undefined)
      settings.lineWidthStart = Math.max(0.5, Math.min(20, s.lineWidthStart))
    if (s.lineWidthEnd !== undefined)
      settings.lineWidthEnd = Math.max(0.3, Math.min(10, s.lineWidthEnd))
    if (s.rainbowBranch !== undefined) settings.rainbowBranch = s.rainbowBranch
    if (s.lineStyle !== undefined) settings.lineStyle = s.lineStyle
    if (s.taperedEdge !== undefined) settings.taperedEdge = s.taperedEdge
    if (s.showOrderBadge !== undefined) settings.showOrderBadge = s.showOrderBadge
  },
  getSettings: (): MindMapSettings => ({
    autoBalanceOnChange: settings.autoBalanceOnChange,
    lineWidthStart: settings.lineWidthStart,
    lineWidthEnd: settings.lineWidthEnd,
    rainbowBranch: settings.rainbowBranch,
    lineStyle: settings.lineStyle,
    layoutMode: settings.layoutMode,
    taperedEdge: settings.taperedEdge,
    showOrderBadge: settings.showOrderBadge,
  }),
})

watch(
  () => props.data,
  (v) => {
    dataRef.value = clone(v)
    triggerRef()
  },
  { deep: false }
)

onMounted(() => {
  nextTick(() => resetView())
})

// re-center when layout dimensions change
watch(
  () => layoutResult.value.width,
  () => nextTick(() => resetView())
)
</script>

<template>
  <div
    class="zm-mindmap"
    :style="{ background: theme.bgColor, fontSize: theme.fontSize + 'px' }"
  >
    <div
      ref="wrapperRef"
      class="zm-canvas"
      @mousedown="onCanvasMouseDown"
      @contextmenu.prevent
      @wheel="panZoom.onWheel"
      @click="onCanvasClick"
    >
      <!-- SVG layer: positioned in world coords (vbX, vbY) scaled by
           panZoom.scale and offset by panZoom.offsetX/Y.  This MUST
           match the .zm-world's translate+scale exactly so that
           SVG edges line up with the DOM node rectangles — without
           this alignment, edges and nodes drift apart at any zoom
           ≠ 1 (the SVG's viewBox-internal (0,0) corresponds to
           (vbX, vbY) in world space, so the SVG element's CSS left
           is vbX*scale + panX, not panX). -->
      <div
        class="zm-svg-layer"
        :style="{
          left: (layoutResult.vbX * panZoom.scale.value + panZoom.offsetX.value) + 'px',
          top: (layoutResult.vbY * panZoom.scale.value + panZoom.offsetY.value) + 'px',
          width: (layoutResult.vbW * panZoom.scale.value) + 'px',
          height: (layoutResult.vbH * panZoom.scale.value) + 'px',
        }"
      >
        <svg
          class="zm-svg"
          :viewBox="viewBox"
          preserveAspectRatio="xMinYMin meet"
          :width="layoutResult.vbW * panZoom.scale.value"
          :height="layoutResult.vbH * panZoom.scale.value"
        >
          <g class="zm-edges">
            <path
              v-for="e in edges"
              :key="e.key"
              :d="variableWidthPath(lineAnchor(e.from, 'out', e.to.side, e.to), lineAnchor(e.to, 'in'), lineWidthForDepth(e.from.depth), endWidthForDepth(e.to.depth), 32, settings.lineStyle, e.to._dir)"
              :fill="lineColorFor(e.from, e.to)"
              stroke="none"
            />
          </g>
        </svg>
      </div>

      <!-- Marquee rectangle: shown when the user is dragging on
           the empty canvas. Positioned in screen-space (does NOT
           follow the world transform) so it tracks the pointer
           1:1 regardless of zoom or pan. -->
      <div
        v-if="panZoom.isMarquee.value"
        class="zm-marquee"
        :style="{
          left: (panZoom.marquee.x * panZoom.scale.value + panZoom.offsetX.value) + 'px',
          top: (panZoom.marquee.y * panZoom.scale.value + panZoom.offsetY.value) + 'px',
          width: (panZoom.marquee.width * panZoom.scale.value) + 'px',
          height: (panZoom.marquee.height * panZoom.scale.value) + 'px',
        }"
      />

      <div
        class="zm-world"
        :style="{
          transform: `translate(${panZoom.offsetX.value}px, ${panZoom.offsetY.value}px) scale(${panZoom.scale.value})`,
        }"
      >
        <div
          v-for="n in allNodes"
          :key="n.id"
          class="zm-node"
          :data-node-id="n.id"
          :class="{
            'is-root': n.isRoot,
            'is-selected': selectedId === n.id,
            'is-editing': editingId === n.id,
          }"
          :style="{
            left: nodeDrag.nodePos(n).x + 'px',
            top: nodeDrag.nodePos(n).y + 'px',
            minWidth: n.width + 'px',
            height: n.height + 'px',
            fontSize: n.fontSize + 'px',
            background: nodeBg(n),
            color: nodeFg(n),
            borderColor: nodeBorder(n),
            fontWeight: nodeFontWeight(n),
            // 1.html centering trick: position the box by its center
            // (x,y) and let the browser center it via transform.
            // The in-flight drag delta is folded into `left`/`top` via
            // nodePos so the SVG edges (which also read nodePos)
            // track the node 1:1 while the user drags.  Adding it
            // to the transform on top would shift the node by 2×.
            transform: `translate(-50%, -50%)`,
          }"
          @mousedown="(e) => nodeDrag.startNodeDrag(e, n, readonly)"
          @click="(e) => onNodeClick(e, n)"
          @dblclick="(e) => { e.stopPropagation(); if (!readonly) startEdit(n.id) }"
        >
          <span v-if="editingId !== n.id" class="zm-text">{{ n.text }}</span>
          <input
            v-else
            class="zm-input"
            v-model="editText"
            autofocus
            @blur="commitEdit()"
            @keydown.enter.exact="commitEdit({ addSibling: 'after' })"
            @keydown.shift.enter.prevent.exact="commitEdit({ addSibling: 'before' })"
            @keydown.tab.prevent="commitEdit({ addChild: true })"
            @keydown.esc="cancelEdit"
            @keydown="onEditKeydown"
            @mousedown.stop
            @click.stop
          />

          <span
            v-if="showOrderBadge"
            class="zm-order-badge"
            :title="`数据顺序：第 ${siblingIndexOf(n.id) + 1} 个`"
          >{{ siblingIndexOf(n.id) + 1 }}</span>

          <span
            v-if="isCollapsed(n.id) && !n.isRoot && collapsedChildCount(n.id) > 0"
            class="zm-collapse-badge"
            :class="{ 'is-on-left': n.side === -1 }"
            :title="`展开 ${collapsedChildCount(n.id)} 个子节点`"
            @mousedown.stop
            @click.stop="toggleCollapse(n.id)"
          >{{ collapsedChildCount(n.id) }}</span>

          <button
            v-if="!readonly && !n.isRoot && nodeHasChildren(n)"
            class="zm-btn zm-collapse"
            :class="{ 'is-on-left': n.side === -1 }"
            :title="isCollapsed(n.id) ? '展开' : '折叠'"
            @mousedown.stop
            @click.stop="toggleCollapse(n.id)"
          >
            <Icon :name="isCollapsed(n.id) ? 'expand' : 'collapse'" :size="12" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="!props.previewMode" class="zm-toolbar">
      <button class="zm-tb-btn" title="放大" @click="panZoom.zoomIn">
        <Icon name="zoom-in" />
      </button>
      <button class="zm-tb-btn" title="缩小" @click="panZoom.zoomOut">
        <Icon name="zoom-out" />
      </button>
      <button class="zm-tb-btn" title="重置视图" @click="resetView">
        <Icon name="reset" />
      </button>
      <span class="zm-tb-divider" />
      <button
        v-if="!readonly"
        class="zm-tb-btn"
        title="添加子节点 (Tab)"
        @click="selectedId && doAddChild(selectedId)"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3 v12" />
          <path d="M7 10 l5 5 l5 -5" />
          <line x1="3" y1="21" x2="21" y2="21" />
        </svg>
      </button>
      <button
        v-if="!readonly"
        class="zm-tb-btn"
        title="添加同级 (Enter)"
        @click="selectedId && doAddSibling(selectedId)"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="12" y1="3" x2="12" y2="21" />
        </svg>
      </button>
      <span class="zm-tb-divider" />
      <!-- 1.html-style layout mode switcher.  Each button highlights
           when its mode is active.  Clicking triggers a re-layout. -->
      <button
        class="zm-tb-btn"
        :class="{ active: settings.layoutMode === 'mindmap' }"
        title="思维导图布局 (中心辐射)"
        @click="setLayoutMode('mindmap')"
      >
        <Icon name="mindmap" />
      </button>
      <button
        class="zm-tb-btn"
        :class="{ active: settings.layoutMode === 'tree' }"
        title="树形布局 (向右展开)"
        @click="setLayoutMode('tree')"
      >
        <Icon name="tree" />
      </button>
      <button
        class="zm-tb-btn"
        :class="{ active: settings.layoutMode === 'org' }"
        title="组织结构布局 (向下展开)"
        @click="setLayoutMode('org')"
      >
        <Icon name="org" />
      </button>
      <span class="zm-tb-divider" />
      <button
        v-if="!readonly"
        class="zm-tb-btn"
        title="导入 JSON"
        @click="importFromFile"
      >
        <Icon name="import" />
      </button>
      <button class="zm-tb-btn" title="导出 JSON" @click="exportToFile">
        <Icon name="export" />
      </button>
      <span class="zm-tb-tip">{{ Math.round(panZoom.scale.value * 100) }}%</span>
    </div>
  </div>
</template>

<style>
.zm-mindmap {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  user-select: none;
}
.zm-canvas {
  position: absolute;
  inset: 0;
  cursor: grab;
}
.zm-canvas:active {
  cursor: grabbing;
}
.zm-world {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
}
.zm-svg-layer {
  position: absolute;
  /* Position is set inline via the world→screen mapping
     (vbX*scale + panX, vbY*scale + panY).  No CSS transform here
     so the SVG layer's geometry matches the .zm-world's
     translate+scale exactly. */
  pointer-events: none;
  overflow: visible;
}
.zm-marquee {
  position: absolute;
  border: 1px dashed #3b82f6;
  background: rgba(59, 130, 246, 0.08);
  pointer-events: none;
  z-index: 5;
}
.zm-svg {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  overflow: visible;
  shape-rendering: geometricPrecision;
}
.zm-node {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 1.6em;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid;
  line-height: 1.2;
  cursor: move;
  transition: box-shadow 0.15s, transform 0.05s;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  white-space: nowrap;
  z-index: 1;
}
.zm-node:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 2;
}
.zm-node.is-root {
  font-weight: 600;
}
.zm-node.is-selected {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
  z-index: 3;
}
.zm-text {
  pointer-events: none;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.zm-input {
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: center;
  width: 100%;
  min-width: 40px;
}
.zm-btn {
  position: absolute;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: #3b82f6;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, transform 0.15s;
  z-index: 4;
}
.zm-node:hover .zm-btn,
.zm-node.is-selected .zm-btn {
  opacity: 1;
}
.zm-btn:hover {
  transform: scale(1.15);
}
.zm-collapse {
  /* Position the toggle on the "line-out" side of the node:
   *  - right-side node (n.side === 1) → button on the right edge
   *  - left-side node  (n.side === -1) → button on the left edge.
   * The default is right-edge (right-side nodes); .is-on-left
   * overrides. */
  right: -8px;
  top: 50%;
  transform: translateY(-50%);
  background: #64748b;
}
.zm-collapse.is-on-left {
  right: auto;
  left: -8px;
}
.zm-collapse:hover {
  transform: translateY(-50%) scale(1.15);
}
/* xmind-style collapsed child-count badge.  Sits on the line-out
 * side of the node (right edge for right-side nodes, left edge for
 * left-side), vertically centered.  Click to expand. */
.zm-collapse-badge {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  left: calc(100% + 8px);
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 5px;
  background: #fb923c;
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  user-select: none;
  z-index: 2;
}
.zm-collapse-badge.is-on-left {
  left: auto;
  right: calc(100% + 8px);
}
.zm-collapse-badge:hover {
  background: #f97316;
}
/* Debug overlay: draws a small "1./2./3." label on every node
 * showing its position in its parent's children array.  Hidden by
 * default — enable with `?debug=order` in the URL. */
.zm-order-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 0 5px;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  color: #475569;
  background: #e2e8f0;
  border-radius: 3px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  user-select: none;
  vertical-align: middle;
}
.zm-toolbar {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  z-index: 10;
}
.zm-tb-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: #475569;
}
.zm-tb-btn:hover {
  background: #f1f5f9;
  color: #1e293b;
}
.zm-tb-btn.active {
  background: var(--zm-tb-active, #fff7ed);
  color: var(--zm-tb-active-fg, #c2410c);
}
.zm-tb-divider {
  width: 1px;
  height: 18px;
  background: #e2e8f0;
  margin: 0 4px;
}
.zm-tb-tip {
  font-size: 12px;
  color: #64748b;
  min-width: 38px;
  text-align: center;
}
</style>
