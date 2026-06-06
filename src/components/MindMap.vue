<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onMounted } from 'vue'
import Icon from './Icon.vue'
import { layout, type LayoutNode } from '../core/layout'
import {
  addChild,
  addSibling,
  addSiblingBefore,
  removeNode,
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
  }>(),
  { readonly: false }
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

/** Undo/redo stack.  Every mutation calls `record()` AFTER applying the
 *  change; undo() / redo() then swap dataRef with a previous snapshot. */
const history = useHistory(100)

/** Snapshot the current tree so the next mutation can be undone. */
function record() {
  history.record(dataRef.value)
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
  // If the user opted in to "auto-balance on change", snap to balanced
  // layout after every mutation.  We schedule it in nextTick so it
  // runs after the current layoutResult computed settles.
  if (settings.autoBalanceOnChange && !props.readonly) {
    nextTick(() => {
      balanced.value = true
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
  autoBalanceOnChange: false,
  lineWidthStart: 2.2,
  lineWidthEnd: 0.8,
  rainbowBranch: false,
})

const lrRootChildren = computed<LayoutNode[]>(() => layoutResult.value.root.children)

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
  onChange: () => triggerRef(),
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
  const data = clone(dataRef.value)
  applyCollapse(data)
  const r = layout(data, { balanced: balanced.value })
  return r
})

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
    dataRef.value = restored
    selectedId.value = null
    emit('select', null)
    triggerRef()
    emit('change', dataRef.value)
  }
}

function doRedo() {
  const restored = history.redo()
  if (restored) {
    dataRef.value = restored
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

function onNodeClick(e: MouseEvent, n: LayoutNode) {
  e.stopPropagation()
  selectedId.value = n.id
  const data = findNode(dataRef.value, n.id)
  emit('select', data)
}

/** Click on the canvas background (not on a node) — clear the
 *  current selection and tell the parent. */
function onCanvasClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (!target) return
  // Ignore clicks that land on a node or its control buttons.
  if (target.closest('.zm-node')) return
  if (selectedId.value !== null) {
    selectedId.value = null
    emit('select', null)
  }
}

function isCollapsed(id: string) {
  return collapsedIds.value.has(id)
}

function nodeHasChildren(n: LayoutNode) {
  const data = findNode(dataRef.value, n.id)
  return !!data && data.children.length > 0
}

function bezierPath(
  from: { x: number; y: number },
  to: { x: number; y: number }
): string {
  // xmind-style: from the parent's side edge horizontally out, then bend
  // to the child's side edge. Control points are 50% of the horizontal gap
  // away from each end, on the SAME y as the endpoint they belong to,
  // which gives a smooth S-curve that hugs the horizontal first.
  const dx = Math.abs(to.x - from.x) * 0.5
  const sx = from.x + (to.x > from.x ? dx : -dx)
  const ex = to.x + (to.x > from.x ? -dx : dx)
  return `M ${from.x} ${from.y} C ${sx} ${from.y}, ${ex} ${to.y}, ${to.x} ${to.y}`
}

/** Control points for the same bezier as bezierPath(), returned as
 *  {x1,y1,x2,y2} so the template can split the curve into N
 *  segments for the tapered-stroke effect. */
function bezierControls(
  from: { x: number; y: number },
  to: { x: number; y: number }
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = Math.abs(to.x - from.x) * 0.5
  const sx = from.x + (to.x > from.x ? dx : -dx)
  const ex = to.x + (to.x > from.x ? -dx : dx)
  return { x1: sx, y1: from.y, x2: ex, y2: to.y }
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

/** Render one edge as a sequence of small segments whose stroke
 *  width tapers from `start` at the parent end to `end` at the child
 *  end.  Returns an array of { d, w } for the template. */
function taperedSegments(
  from: { x: number; y: number },
  to: { x: number; y: number },
  start: number,
  end: number,
  n = 6
): { d: string; w: number }[] {
  const c = bezierControls(from, to)
  const out: { d: string; w: number }[] = []
  for (let i = 0; i < n; i++) {
    const t0 = i / n
    const t1 = (i + 1) / n
    const p0 = i === 0 ? from : cubicAt(t0, from, c, to)
    const p1 = cubicAt(t1, from, c, to)
    // taper: width lerps from `start` (at t=0) to `end` (at t=1)
    const w = start + (end - start) * t0
    out.push({ d: `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`, w: Math.max(0.2, w) })
  }
  return out
}

function lineAnchor(
  n: LayoutNode,
  side: 'in' | 'out',
  dir?: 1 | -1,
  toY?: number
): { x: number; y: number } {
  const p = nodeDrag.nodePos(n)
  // For the root, fan the outgoing lines out from the node's side edge
  // along its height — each line starts at the y of its target child
  // (clamped to the root's vertical extent). This matches xmind's
  // "spread" look instead of bundling every line through the root center.
  if (n.isRoot && side === 'out') {
    const d = (dir ?? 1) as 1 | -1
    const half = n.height / 2
    const top = p.y - half
    const bot = p.y + half
    const y = toY === undefined ? p.y : Math.max(top, Math.min(bot, toY))
    return { x: p.x + d * (n.width / 2), y }
  }
  // Both 'in' and (non-root) 'out' anchor at the node's own y so the line
  // lands precisely on the node's side mid-point. The bezier control points
  // do the smoothing (xmind-style).
  const y = p.y
  if (n.isRoot) {
    const d = (dir ?? 1) as 1 | -1
    return { x: p.x + d * (n.width / 2), y }
  }
  let d: 1 | -1
  if (side === 'in') {
    // the 'in' side faces the parent, so it is the opposite of n.side
    d = (-n.side) as 1 | -1
  } else {
    d = n.side
  }
  if (dir !== undefined) d = dir
  return { x: p.x + d * (n.width / 2), y }
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
  // 3. force a layoutVersion bump so the computed re-runs immediately
  triggerRef()
  // 4. re-center the view so the user sees the result
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
      settings.lineWidthStart = Math.max(0.3, Math.min(8, s.lineWidthStart))
    if (s.lineWidthEnd !== undefined)
      settings.lineWidthEnd = Math.max(0.2, Math.min(8, s.lineWidthEnd))
    if (s.rainbowBranch !== undefined) settings.rainbowBranch = s.rainbowBranch
  },
  getSettings: (): MindMapSettings => ({
    autoBalanceOnChange: settings.autoBalanceOnChange,
    lineWidthStart: settings.lineWidthStart,
    lineWidthEnd: settings.lineWidthEnd,
    rainbowBranch: settings.rainbowBranch,
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
      @mousedown="panZoom.startPan"
      @wheel="panZoom.onWheel"
      @click="onCanvasClick"
    >
      <div
        class="zm-world"
        :style="{
          transform: `translate(${panZoom.offsetX.value}px, ${panZoom.offsetY.value}px) scale(${panZoom.scale.value})`,
        }"
      >
        <svg
          class="zm-svg"
          :viewBox="viewBox"
          preserveAspectRatio="xMidYMid meet"
          :width="layoutResult.vbW"
          :height="layoutResult.vbH"
          :style="{
            left: layoutResult.vbX + 'px',
            top: layoutResult.vbY + 'px',
          }"
        >
          <g class="zm-edges">
            <template v-for="e in edges" :key="e.key">
              <path
                v-for="(seg, i) in taperedSegments(lineAnchor(e.from, 'out', e.to.side, nodeDrag.nodePos(e.to).y), lineAnchor(e.to, 'in'), settings.lineWidthStart, settings.lineWidthEnd)"
                :key="e.key + '-s' + i"
                :d="seg.d"
                fill="none"
                :stroke="lineColorFor(e.from, e.to)"
                :stroke-width="seg.w"
              />
            </template>
          </g>
        </svg>

        <div
          v-for="n in allNodes"
          :key="n.id"
          class="zm-node"
          :class="{
            'is-root': n.isRoot,
            'is-selected': selectedId === n.id,
            'is-editing': editingId === n.id,
          }"
          :style="{
            left: nodeDrag.nodePos(n).x - n.width / 2 + 'px',
            top: nodeDrag.nodePos(n).y - n.height / 2 + 'px',
            minWidth: n.width + 'px',
            height: n.height + 'px',
            fontSize: n.fontSize + 'px',
            background: nodeBg(n),
            color: nodeFg(n),
            borderColor: nodeBorder(n),
            fontWeight: nodeFontWeight(n),
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

          <button
            v-if="!readonly && !n.isRoot && nodeHasChildren(n)"
            class="zm-btn zm-collapse"
            :title="isCollapsed(n.id) ? '展开' : '折叠'"
            @mousedown.stop
            @click.stop="toggleCollapse(n.id)"
          >
            <Icon :name="isCollapsed(n.id) ? 'expand' : 'collapse'" :size="12" />
          </button>

          <template v-if="!readonly">
            <button
              class="zm-btn zm-add"
              :title="'添加子节点 (Tab)'"
              @mousedown.stop
              @click.stop="doAddChild(n.id)"
            >
              <Icon name="add" :size="12" />
            </button>
            <button
              v-if="!n.isRoot"
              class="zm-btn zm-del"
              :title="'删除 (Del)'"
              @mousedown.stop
              @click.stop="doRemove(n.id)"
            >
              <Icon name="delete" :size="12" />
            </button>
          </template>
        </div>
      </div>
    </div>

    <div class="zm-toolbar">
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
        <Icon name="add" />
      </button>
      <button
        v-if="!readonly"
        class="zm-tb-btn"
        title="添加同级 (Enter)"
        @click="selectedId && doAddSibling(selectedId)"
      >
        <Icon name="edit" />
      </button>
      <span class="zm-tb-divider" />
      <button
        class="zm-tb-btn"
        title="平衡图表:重新均匀分布各分支,并撤销手动拖动"
        @click="runBalance"
      >
        <Icon name="balance" />
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
  will-change: transform;
}
.zm-svg {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  overflow: visible;
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
.zm-add {
  right: -8px;
  top: 50%;
  transform: translateY(-50%);
}
.zm-add:hover {
  transform: translateY(-50%) scale(1.15);
}
.zm-collapse {
  left: -8px;
  top: 50%;
  transform: translateY(-50%);
  background: #64748b;
}
.zm-collapse:hover {
  transform: translateY(-50%) scale(1.15);
}
.zm-del {
  right: -8px;
  top: -8px;
  background: #ef4444;
}
.zm-del:hover {
  transform: scale(1.15);
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
