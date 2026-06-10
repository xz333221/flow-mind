<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'
// Reuse the add-node icons from the outline panel.  Vite ?url
// gives a stable URL we can pass to <img src=…>; the buttons
// stay styled by .zm-tb-btn.
import addNodeIcon from '../assets/svg/add-node.svg?url'
import addSubNodeIcon from '../assets/svg/add-sub-node.svg?url'
import { layout, type LayoutNode } from '../core/layout'
import { BUILTIN_PALETTES, resolvePalette, type BranchPalette } from '../core/palettes'
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
  markdownToMindMap,
  mindMapToMarkdown,
} from '../tree'
import type { MindMapNode, MindMapTheme, MindMapExpose, MindMapSettings, NodeStyle, MindMapImage } from '../types'
import { usePanZoom } from '../composables/usePanZoom'
import { useKeyboard } from '../composables/useKeyboard'
import { useHistory } from '../composables/useHistory'
import NodeContextMenu from './NodeContextMenu.vue'
import {
  codeLang,
  highlightCode,
  sortTable,
  stripCodeFence,
  tableRows,
  type SortDir,
} from '../composables/useRichContent'

const props = withDefaults(
  defineProps<{
    data: MindMapNode
    theme?: MindMapTheme
    /**
     * When true, hides the MindMap's own toolbar and disables every
     * edit operation (add/remove/edit/drag/paste/rich-edit/note
     * edit/context menu).  Expand/collapse stays available so the
     * user can still navigate a large tree.  The app-level top
     * toolbar / drawers are controlled by the parent (App.vue).
     */
    previewMode?: boolean
    /**
     * Optional raw markdown source.  When set, the component parses
     * it into the data tree and ignores `data` (use one or the
     * other).  Editing nodes on the canvas emits `markdownChange`
     * with the re-serialized form, so the host can keep its
     * markdown source in sync without polling.  Pass an empty
     * string to clear.
     */
    markdown?: string
    /**
     * Optional per-edge color list.  When set, top-level branches
     * draw their edges (and their descendant edges under
     * `rainbowBranch`) using these colors in order, wrapping
     * around.  Overrides the palette picked by `branchPaletteId`
     * / `customPalettes`.  Pass an empty array to fall back to
     * the palette pipeline.
     */
    lineColors?: string[]
  }>(),
  { previewMode: false }
)

const emit = defineEmits<{
  (e: 'change', data: MindMapNode): void
  (e: 'select', node: MindMapNode | null): void
  /** Fired when the user clicks a node's note icon or picks
   *  "添加笔记" / "编辑笔记" from the right-click menu.  The
   *  parent is expected to open the right-side note drawer
   *  scoped to the given node. */
  (e: 'edit-note', nodeId: string): void
  /** Fired when `markdown` is in use and the underlying data
   *  changes (user edit, import, etc).  The string is the
   *  re-serialized markdown representation. */
  (e: 'markdownChange', markdown: string): void
}>()

const wrapperRef = ref<HTMLElement | null>(null)
const editingId = ref<string | null>(null)
const editText = ref('')
const selectedId = ref<string | null>(null)
const collapsedIds = ref<Set<string>>(new Set())
// True when the cursor is over the canvas.  In preview mode the
// bottom toolbar fades in on hover; in non-preview mode this is
// ignored (the toolbar stays put).
const canvasHovered = ref(false)

// In-place rich body edit: which node has its code/table flipped
// into edit mode, and the live draft text.  Only one node can be
// in this state at a time.  Sort state is also per-node so the
// same node keeps its sort across re-renders.  Both are plain
// Maps keyed by node id — they hold no data-tree state.
const richEditingId = ref<string | null>(null)
const richEditDraft = ref('')
const sortState = ref<Map<string, { col: number; dir: SortDir }>>(new Map())
const dataRef = ref<MindMapNode>(clone(props.data))
// Post-render measurements of each node's rich body
// (<div class="zm-rich">).  Populated by `measureRichBodies()`
// after every layout-affecting mutation, consumed by `layout()`
// via the `richHeights` / `richWidths` options.  Re-rendering
// after the size changes re-lays out the tree so neighbouring
// nodes don't collide with the new box.
const richHeights = ref<Record<string, number>>({})
const richWidths = ref<Record<string, number>>({})
// `usingMarkdown` is true when the current dataRef was derived from
// the `markdown` prop.  Used by the change-watcher below to decide
// whether to emit `markdownChange` after a user edit.
const usingMarkdown = ref(props.markdown !== undefined)
// Set when the watcher on props.markdown writes into dataRef, so the
// dataRef watcher can ignore that write-back and not emit a
// markdownChange loop.
let suppressMarkdownEmit = false

watch(
  () => props.markdown,
  (md) => {
    if (md === undefined) {
      usingMarkdown.value = false
      return
    }
    usingMarkdown.value = true
    // Parse and replace the data tree, but mark the change as
    // "internal" so the dataRef watcher doesn't echo it back as
    // markdownChange.
    const parsed = markdownToMindMap(md || '')
    suppressMarkdownEmit = true
    dataRef.value = clone(parsed)
    selectedId.value = null
    collapsedIds.value = new Set()
    triggerRef()
    nextTick(() => {
      suppressMarkdownEmit = false
      resetView()
    })
  },
)

// After any data-mutating path (addChild, removeNode, edit, import,
// paste, …), the `change` emit is fired.  When the user is in
// markdown mode we also fire `markdownChange` with the re-serialized
// form so the host can keep its source in sync.
watch(
  dataRef,
  () => {
    if (usingMarkdown.value && !suppressMarkdownEmit) {
      emit('markdownChange', mindMapToMarkdown(dataRef.value))
    }
  },
  { deep: true },
)
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

// ---------------------------------------------------------------------------
// Node image — embedded picture shown above the node text.  The user picks
// a file via the on-canvas button; we read it as a data URL, capture the
// natural dimensions, and stash it on the data tree.  Width/height are
// user-tweakable via a drag handle on the bottom-right corner of the
// node.  The drag handle writes back through `applyNodeImage`.
// ---------------------------------------------------------------------------
const IMG_MIN_W = 24
const IMG_MAX_W = 400
/** Default rendered width for a freshly uploaded image, capped to a
 *  sane size so a 4000×3000 photo doesn't explode the layout. */
const IMG_DEFAULT_W = 160

function applyNodeImage(id: string, image: MindMapImage) {
  const n = findNode(dataRef.value, id)
  if (!n) return
  n.image = {
    src: image.src,
    naturalW: image.naturalW,
    naturalH: image.naturalH,
    width: clamp(image.width, IMG_MIN_W, IMG_MAX_W),
    height: clamp(image.height, IMG_MIN_W, IMG_MAX_W),
  }
  record()
  triggerRef()
  emit('change', dataRef.value)
}

function removeNodeImage(id: string) {
  const n = findNode(dataRef.value, id)
  if (!n || !n.image) return
  delete n.image
  record()
  triggerRef()
  emit('change', dataRef.value)
}

/** Set / replace / clear a node's image from a plain URL or
 *  data: URI.  Used by the right-side panel's image input — the
 *  image picker is still the canvas's file-input flow.  We have
 *  to fetch the asset to read its natural dimensions; on failure
 *  we fall back to IMG_DEFAULT_W squared so the node still has a
 *  visible image shape. */
function applyNodeImageByUrl(id: string, url: string) {
  const trimmed = url.trim()
  const n = findNode(dataRef.value, id)
  if (!n) return
  if (!trimmed) {
    removeNodeImage(id)
    return
  }
  const img = new Image()
  img.onload = () => {
    const n2 = findNode(dataRef.value, id)
    if (!n2) return
    // Lock aspect ratio, clamp width to IMG_MAX_W, fall back
    // to a square when the image is broken.
    const aspect = img.naturalWidth && img.naturalHeight
      ? img.naturalWidth / img.naturalHeight
      : 1
    const w = clamp(
      img.naturalWidth || IMG_DEFAULT_W,
      IMG_MIN_W,
      IMG_MAX_W
    )
    const h = Math.round(w / aspect)
    n2.image = {
      src: trimmed,
      naturalW: img.naturalWidth || w,
      naturalH: img.naturalHeight || h,
      width: w,
      height: h,
    }
    record()
    triggerRef()
    emit('change', dataRef.value)
  }
  img.onerror = () => {
    // Keep what was there before, but the panel hides a broken
    // image via its own @error handler.  We could fall back to
    // a 1×1 placeholder; for now just leave the existing image
    // untouched so the user can correct the URL.
  }
  img.src = trimmed
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Read a File into a data URL, decode its natural dimensions, and
 *  call onLoaded({ src, naturalW, naturalH }).  No-op on error. */
function readImageFile(file: File, onLoaded: (img: MindMapImage) => void) {
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result !== 'string') return
    const src = reader.result
    const probe = new window.Image()
    probe.onload = () => {
      const naturalW = probe.naturalWidth || IMG_DEFAULT_W
      const naturalH = probe.naturalHeight || IMG_DEFAULT_W
      // Default rendered width: keep naturalW but cap at IMG_DEFAULT_W.
      const width = clamp(naturalW, IMG_MIN_W, IMG_DEFAULT_W)
      const height = clamp(Math.round((naturalH * width) / naturalW), IMG_MIN_W, IMG_MAX_W)
      onLoaded({ src, naturalW, naturalH, width, height })
    }
    probe.onerror = () => {
      // Some images (SVG, very small) — fall back to a 1:1 box.
      onLoaded({ src, naturalW: IMG_DEFAULT_W, naturalH: IMG_DEFAULT_W, width: IMG_DEFAULT_W, height: IMG_DEFAULT_W })
    }
    probe.src = src
  }
  reader.readAsDataURL(file)
}

/** Click the on-canvas "image" button → open a hidden file picker.
 *  Hidden in the template; we trigger it programmatically. */
function onPickImage(nodeId: string) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.style.display = 'none'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    readImageFile(file, (img) => applyNodeImage(nodeId, img))
    document.body.removeChild(input)
  }
  document.body.appendChild(input)
  input.click()
}

// ---------------------------------------------------------------------------
// Per-node link / note — the data model lives on the MindMapNode itself
// (`link?: { url }`, `note?: { text }`).  These helpers mirror the
// applyNodeImage pattern: read the existing node, mutate, snapshot,
// trigger re-layout.
// ---------------------------------------------------------------------------
function applyNodeLink(id: string, url: string) {
  const trimmed = url.trim()
  const n = findNode(dataRef.value, id)
  if (!n) return
  if (!trimmed) {
    delete n.link
  } else {
    n.link = { url: trimmed }
  }
  record()
  triggerRef()
  emit('change', dataRef.value)
}
function removeNodeLink(id: string) {
  applyNodeLink(id, '')
}
function applyNodeNote(id: string, text: string) {
  const n = findNode(dataRef.value, id)
  if (!n) return
  if (!text) {
    delete n.note
  } else {
    n.note = { text }
  }
  record()
  triggerRef()
  emit('change', dataRef.value)
}
function removeNodeNote(id: string) {
  applyNodeNote(id, '')
}
function applyNodeRichContent(id: string, content: { kind: 'code' | 'table'; raw: string; lang?: string } | null) {
  const n = findNode(dataRef.value, id)
  if (!n) return
  if (!content) {
    delete n.richContent
  } else {
    n.richContent = content
  }
  record()
  triggerRef()
  emit('change', dataRef.value)
}

// ---------------------------------------------------------------------------
// Context menu — right-click a node to open a small popover with
// "添加/替换图片", "添加/编辑链接", "添加/编辑笔记" actions.
// Each action either triggers a file picker, a prompt(), or the
// inline note editor.  The menu is unmounted on any of: outside
// click, Esc, scroll, or right-click on another node.
// ---------------------------------------------------------------------------
interface MenuState {
  nodeId: string
  /** ClientX of the right-click. */
  x: number
  /** ClientY of the right-click. */
  y: number
}
const contextMenu = ref<MenuState | null>(null)

function onNodeContextMenu(e: MouseEvent, n: LayoutNode) {
  if (props.previewMode) return
  e.preventDefault()
  e.stopPropagation()
  // Selecting the node is implicit — right-clicking a different
  // node should move the selection to it so the menu actions
  // operate on the right node.  If it's the same node, no-op.
  selectedId.value = n.id
  emit('select', findNode(dataRef.value, n.id))
  contextMenu.value = { nodeId: n.id, x: e.clientX, y: e.clientY }
}
function closeContextMenu() {
  contextMenu.value = null
}

function menuPickImage() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  onPickImage(id)
}
function menuSetLink() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  const existing = findNode(dataRef.value, id)?.link?.url ?? ''
  const url = window.prompt('输入链接 URL（留空取消）', existing)
  if (url === null) return // user pressed cancel
  applyNodeLink(id, url)
}
function menuRemoveLink() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  removeNodeLink(id)
}
function menuEditNote() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  emitEditNote(id)
}
function menuRemoveNote() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  removeNodeNote(id)
}
function menuRemoveImage() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  removeNodeImage(id)
}
function menuAddCode() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  const existing = findNode(dataRef.value, id)?.richContent
  const cur = existing?.kind === 'code' ? stripCodeFence(existing.raw) : ''
  const lang = existing?.kind === 'code' ? existing.lang || '' : ''
  const header = lang ? '```' + lang + '\n' : '```\n'
  const placeholder = '// 你的代码'
  const raw = window.prompt(
    '输入代码块内容（用 ```lang 包裹；留空取消）',
    cur ? header + cur + (cur.endsWith('```') ? '' : '\n```') : header + placeholder + '\n```'
  )
  if (raw === null) return
  const trimmed = raw.trim()
  if (!trimmed) {
    applyNodeRichContent(id, null)
    return
  }
  // Detect an opening fence to extract the language tag.
  const m = /^```([^\s`]*)/.exec(trimmed)
  const lang2 = m ? m[1] : undefined
  applyNodeRichContent(id, { kind: 'code', raw: trimmed, lang: lang2 })
}
function menuRemoveCode() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  applyNodeRichContent(id, null)
}
function menuAddTable() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  const existing = findNode(dataRef.value, id)?.richContent
  const cur = existing?.kind === 'table' ? existing.raw : ''
  const placeholder = '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| a | b | c |'
  const raw = window.prompt(
    '输入 markdown 表格（每行以 | 分隔；留空取消）',
    cur || placeholder
  )
  if (raw === null) return
  const trimmed = raw.trim()
  if (!trimmed) {
    applyNodeRichContent(id, null)
    return
  }
  applyNodeRichContent(id, { kind: 'table', raw: trimmed })
}
function menuRemoveTable() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  applyNodeRichContent(id, null)
}

// ---------------------------------------------------------------------------
// Note editing — the actual textarea lives in App.vue's right-side
// "笔记" drawer (NotePanel.vue).  MindMap only knows when the
// user wants to open it, by emitting `edit-note`.  We also keep
// `notePreview` for the icon tooltip.
// ---------------------------------------------------------------------------

/** Ask App.vue to open the note drawer for this node.  The
 *  drawer auto-focuses its textarea on open. */
function emitEditNote(id: string) {
  if (props.previewMode) return
  emit('edit-note', id)
}

/** Truncate the note text to a single-line preview for the icon
 *  tooltip.  Collapses internal whitespace. */
function notePreview(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat || '点击编辑笔记'
  return flat.slice(0, max) + '…'
}

// ---------------------------------------------------------------------------
// Ctrl+V paste — when a node is selected and the clipboard carries
// an image, route it through readImageFile / applyNodeImage.  We
// also intercept text pastes? No: paste-as-text into a selected
// node should NOT replace the node text (that's confusing); the
// user can double-click to enter edit mode and paste there.  This
// handler is image-only.
// ---------------------------------------------------------------------------
function onPaste(e: ClipboardEvent) {
  if (props.previewMode) return
  // Don't hijack paste inside any text-editing surface.
  if (editingId.value) return
  const tgt = e.target as HTMLElement | null
  if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) {
    return
  }
  const sel = selectedId.value
  if (!sel) return
  const items = e.clipboardData?.items
  if (!items) return
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const file = it.getAsFile()
      if (!file) continue
      e.preventDefault()
      const n = findNode(dataRef.value, sel)
      if (n?.image) {
        if (!window.confirm('该节点已有图片,要用剪贴板里的图片替换吗?')) return
      }
      readImageFile(file, (img) => applyNodeImage(sel, img))
      return
    }
  }
}
onMounted(() => {
  window.addEventListener('paste', onPaste)
  // Initial render doesn't go through any data-mutating path, so
  // triggerRef() never fires on mount — but we still need the
  // post-mount rich-body measurement so the layout picks up real
  // heights for code/table nodes.  Call it once here to start
  // the measure → re-layout cycle for the first paint.
  triggerRef()
})
onBeforeUnmount(() => {
  window.removeEventListener('paste', onPaste)
})

// ---------------------------------------------------------------------------
// Resize handle — tracks the in-flight drag (live width/height before
// commit).  We don't write to dataRef on every mouse move; instead we
// update the rendered <img> style directly via a CSS class.  On
// mouseup we push the final size through applyNodeImage() so the
// history snapshot and layout recompute fire exactly once.
// ---------------------------------------------------------------------------
interface ResizeState {
  nodeId: string
  startX: number
  startY: number
  startW: number
  startH: number
  naturalW: number
  naturalH: number
  ratio: number
  pendingW: number
  pendingH: number
}
const resizeState = ref<ResizeState | null>(null)
const resizingId = computed(() => resizeState.value?.nodeId ?? null)

function onResizeStart(e: MouseEvent, n: LayoutNode) {
  if (!n.image) return
  e.preventDefault()
  e.stopPropagation()
  const naturalW = n.image.naturalW || n.image.width
  const naturalH = n.image.naturalH || n.image.height
  // Guard against 0-division on malformed data.
  const ratio = naturalH > 0 ? naturalH / naturalW : 1
  resizeState.value = {
    nodeId: n.id,
    startX: e.clientX,
    startY: e.clientY,
    startW: n.image.width,
    startH: n.image.height,
    naturalW,
    naturalH,
    ratio,
    pendingW: n.image.width,
    pendingH: n.image.height,
  }
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(e: MouseEvent) {
  const s = resizeState.value
  if (!s) return
  // Convert pixel delta through the current scale so the resize
  // tracks the user's perceived speed at any zoom level.
  const scale = panZoom.scale.value || 1
  const dxScreen = e.clientX - s.startX
  const nextW = clamp(s.startW + dxScreen / scale, IMG_MIN_W, IMG_MAX_W)
  const nextH = clamp(nextW * s.ratio, IMG_MIN_W, IMG_MAX_W)
  s.pendingW = nextW
  s.pendingH = nextH
  // Live-update the DOM directly (faster than going through
  // Vue's render).  The data tree isn't touched yet, so the
  // next layout pass will still see the old size — that's fine
  // because the live <img> is the source of truth during the
  // drag and the node box's height/width are also re-pushed
  // (so the resize handle stays anchored to the corner).
  const el = wrapperRef.value?.querySelector<HTMLElement>(
    `[data-node-id="${s.nodeId}"] .zm-node-img`
  )
  if (el) {
    el.style.width = `${nextW}px`
    el.style.height = `${nextH}px`
  }
  // Also grow the node box so the handle stays put.  The text
  // strip is ~30px (NODE_HEIGHTS for tier 1) plus the 8px gap.
  const nodeEl = wrapperRef.value?.querySelector<HTMLElement>(
    `[data-node-id="${s.nodeId}"]`
  )
  if (nodeEl) {
    const textH = 30
    nodeEl.style.minWidth = `${Math.max(80, Math.ceil(nextW + 28))}px`
    nodeEl.style.height = `${Math.ceil(nextH + 8 + textH)}px`
  }
}

function onResizeEnd() {
  const s = resizeState.value
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
  resizeState.value = null
  if (!s) return
  const n = findNode(dataRef.value, s.nodeId)
  if (!n || !n.image) return
  // Commit the new size through the normal mutation path so the
  // history snapshot fires once and the layout recomputes.
  applyNodeImage(s.nodeId, {
    src: n.image.src,
    naturalW: n.image.naturalW,
    naturalH: n.image.naturalH,
    width: s.pendingW,
    height: s.pendingH,
  })
  // The drag's mouseup landed on the canvas, not on the node, so
  // the canvas's click handler will fire next and deselect.  Re-
  // select the node so the resize handle and remove button stay
  // visible after the user lets go of the handle.
  selectedId.value = s.nodeId
  emit('select', n)
  // Suppress the very next canvas click — even after re-selecting,
  // the canvas's click handler runs synchronously and would clear
  // the selection we just set.  The flag is checked once and
  // cleared.
  suppressNextCanvasClick = true
}
// Track which node the user is hovering.  The image-upload button
// shows on hover OR when selected, mirroring the collapse-button
// pattern.  We use a ref (not Vue reactive) so the v-for can
// re-render cheaply.
const hoveredId = ref<string | null>(null)
// Set by onResizeEnd: the drag's mouseup lands on the canvas (not
// the node), and the canvas's click handler would otherwise clear
// the selection we just re-set.  Flag is checked once and cleared.
let suppressNextCanvasClick = false
function onNodeMouseEnter(id: string) {
  hoveredId.value = id
}
function onNodeMouseLeave(id: string) {
  if (hoveredId.value === id) hoveredId.value = null
}
function isNodeInteractive(id: string): boolean {
  // The image-upload button should appear when the node is hovered
  // OR selected.  Same gate as the collapse button on the canvas.
  return hoveredId.value === id || selectedId.value === id
}
const layoutVersion = ref(0)
// Compact layout is the default. The user clicks "balance" to snap
// everything into the balanced layout and re-center the view — the
// layout reverts on the next data change unless the caller opts in
// via setBalanced(true).
const balanced = ref(false)

/** Undo/redo stack.  Every mutation calls `record()` AFTER applying the
 *  change; undo() / redo() then swap dataRef with a previous snapshot. */
const history = useHistory(100)

/** Snapshot the current tree so the next mutation can be undone. */
function record() {
  history.record({ data: dataRef.value })
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
  // Re-measure rich body heights once the DOM has settled, then
  // bump layoutVersion again so a height change forces another
  // re-layout (the loop terminates because the heights are
  // stable on the second pass).
  //
  // Why a *double* nextTick: the first await flushes the layout
  // computed (synchronous) into Vue's render queue, the second
  // await flushes the actual DOM patch — the `.zm-rich` elements
  // we read `offsetHeight` from only exist AFTER both ticks.  A
  // single `nextTick().then(measure)` runs before the DOM is
  // patched, finds zero `.zm-rich` elements, and the layout
  // falls back to its pre-render `richH` estimate forever (the
  // "rich body never resizes to fit content" bug).  Two ticks
  // guarantees the DOM is up-to-date.
  void nextTick()
    .then(() => nextTick())
    .then(() => measureRichBodies())
    .then(() => {
      // The measure above wrote fresh richHeights/richWidths.
      // Bump layoutVersion so allNodes re-derives from the latest
      // layout result.  layoutResult itself is reactive on
      // richHeights, so it has already re-run; this bump is the
      // belt-and-suspenders that makes the change visible even
      // when the measure values are stable.
      layoutVersion.value++
    })
}

// Walk every rendered `.zm-rich` element, read its current
// pixel size, and write it into `richHeights` / `richWidths`
// so the next layout pass reserves the right amount of space.
// Runs in the post-render tick (after Vue has flushed the DOM
// for the latest dataRef change).  The function is idempotent
// — only writes when a value actually changed — so it doesn't
// cause a layout feedback loop.
function measureRichBodies() {
  const els = document.querySelectorAll<HTMLElement>('.zm-rich')
  const nextH: Record<string, number> = {}
  const nextW: Record<string, number> = {}
  let anyChanged = false
  els.forEach((el) => {
    // The node id is stamped on the parent `.zm-node` div as
    // `data-node-id` by the renderer below.  We walk up to
    // find it.
    let cur: HTMLElement | null = el
    let id: string | null = null
    while (cur && !id) {
      id = cur.getAttribute('data-node-id')
      cur = cur.parentElement
    }
    if (!id) return
    // Use `offsetWidth` / `offsetHeight` (the un-transformed
    // box size), not `getBoundingClientRect()` — the canvas's
    // pan/zoom wrapper applies `transform: scale()` so the
    // bounding rect reports the visually-scaled size and would
    // over-reserve when the user is zoomed in.
    const h = el.offsetHeight
    // scrollWidth is needed for width: the `.zm-rich` element
    // itself is capped at `max-width: 260px` (so very wide
    // tables get a horizontal scrollbar in the rich body, and
    // the box stays compact).  We want to size the box to fit
    // the content, so we read the scroll content's width
    // instead of the capped width.
    const w = el.scrollWidth
    // Round to a half-pixel to keep the map stable — sub-pixel
    // jitter from antialiasing would otherwise force a layout
    // recompute on every render.
    const rH = Math.round(h * 2) / 2
    const rW = Math.round(w * 2) / 2
    nextH[id] = rH
    nextW[id] = rW
    if (richHeights.value[id] !== rH) anyChanged = true
    if (richWidths.value[id] !== rW) anyChanged = true
  })
  // Always write the new map back so the first paint — which
  // happens BEFORE any rich body is mounted in the DOM, so
  // `els` is empty and `anyChanged` stays `false` — still
  // replaces the ref.  Without this, the early-return path
  // skips the assignment and the layout keeps seeing the
  // stale `{}` (or the last-paint values) instead of an
  // empty map it can re-derive on the next pass.  A
  // redundant replacement is cheap (Vue's reactivity
  // short-circuits same-content updates) so we just always
  // write.
  richHeights.value = nextH
  richWidths.value = nextW
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
  branchPaletteId: 'default',
  customPalettes: [],
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

const RAINBOW_FALLBACK = BUILTIN_PALETTES[0].colors

// Active palette resolved from settings.branchPaletteId + settings.customPalettes.
// Falls back to the built-in 'default' palette if the id is unknown
// (e.g. a custom palette was deleted).  Recomputed reactively so a
// settings change in the panel re-themes the canvas immediately.
const activePalette = computed<BranchPalette>(() =>
  resolvePalette(settings.branchPaletteId, settings.customPalettes)
)

const branchColor = computed<Map<string, string>>(() => {
  const m = new Map<string, string>()
  if (!settings.rainbowBranch) return m
  // lineColors prop wins over the palette pipeline: if the host
  // hands us an explicit list, use it verbatim (modulo the
  // wrap-around).  An empty / undefined list falls back to the
  // palette lookup.
  const explicit = props.lineColors
  const colors = (explicit && explicit.length > 0)
    ? explicit
    : activePalette.value.colors.length > 0
      ? activePalette.value.colors
      : RAINBOW_FALLBACK
  for (let i = 0; i < lrRootChildren.value.length; i++) {
    const c = lrRootChildren.value[i]
    m.set(c.id, colors[i % colors.length])
  }
  const walk = (n: LayoutNode, hue: string) => {
    m.set(n.id, hue)
    for (const c of n.children) walk(c, hue)
  }
  for (let i = 0; i < lrRootChildren.value.length; i++) {
    const c = lrRootChildren.value[i]
    walk(c, colors[i % colors.length])
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

// keyboard
useKeyboard({
  isEditing: () => editingId.value !== null,
  isReadonly: () => props.previewMode,
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
  return layout(data, {
    mode: settings.layoutMode,
    baseFontSize: theme.value.fontSize,
    richHeights: richHeights.value,
    richWidths: richWidths.value,
  })
})

// Walk the layout in one pass, building both the flat node list and the lookup map
const allNodesComputed = ref<LayoutNode[]>([])
const allNodes = computed<LayoutNode[]>(() => {
  // touch layoutVersion so updates propagate
  void layoutVersion.value
  return allNodesComputed.value
})
watch(
  layoutResult,
  (r) => {
    const list: LayoutNode[] = []
    const walk = (n: LayoutNode) => {
      list.push(n)
      for (const c of n.children) walk(c)
    }
    walk(r.root)
    allNodesComputed.value = list
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

// ---------------------------------------------------------------------------
// In-place rich body edit (code block / table).  Dblclick the
// rich body to flip into a textarea; blur or Enter commits,
// Escape cancels.  Writes back through the same
// `applyNodeRichContent` helper the context menu / NotePanel
// use, so undo and the change emit fire once.
// ---------------------------------------------------------------------------
function startRichEdit(id: string) {
  if (props.previewMode) return
  const n = findNode(dataRef.value, id)
  if (!n?.richContent) return
  richEditingId.value = id
  richEditDraft.value = n.richContent.raw
  nextTick(() => {
    const ta = document.querySelector<HTMLTextAreaElement>(
      '.zm-node .zm-rich textarea'
    )
    ta?.focus()
  })
}
function commitRichEdit() {
  if (!richEditingId.value) return
  const id = richEditingId.value
  const n = findNode(dataRef.value, id)
  const next = richEditDraft.value
  if (n && n.richContent && n.richContent.raw !== next) {
    if (n.richContent.kind === 'code') {
      const lang = codeLang(next) || undefined
      applyNodeRichContent(id, { kind: 'code', raw: next, lang })
    } else {
      applyNodeRichContent(id, { kind: 'table', raw: next })
    }
  }
  richEditingId.value = null
}
function cancelRichEdit() {
  richEditingId.value = null
}
function onRichEditKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    cancelRichEdit()
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    commitRichEdit()
  }
}

// Sort UI for the on-canvas table.  Same asc/desc/off cycle as
// the panel; state is per-node so different tables can be sorted
// independently.
function toggleNodeSort(id: string, col: number) {
  const cur = sortState.value.get(id)
  if (!cur || cur.col !== col) {
    sortState.value.set(id, { col, dir: 'asc' })
  } else if (cur.dir === 'asc') {
    sortState.value.set(id, { col, dir: 'desc' })
  } else {
    sortState.value.delete(id)
  }
}
// Apply the per-node sort (if any) before the template iterates.
function sortedTableRows(id: string, rows: string[][]): string[][] {
  const s = sortState.value.get(id)
  if (!s || rows.length <= 1) return rows
  return sortTable(rows, s.col, s.dir)
}
function sortMark(id: string, col: number): string {
  const s = sortState.value.get(id)
  if (!s || s.col !== col) return '↕'
  return s.dir === 'asc' ? '▲' : '▼'
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

// ── rich body helpers ────────────────────────────────────────
//
// Convert a richContent.raw payload into the fragments the
// template renders.  Kept as plain functions (not computed) so
// the template can call them inline and re-runs are cheap
// (each block is ≤ a few KB of markdown).

/** Strip the bullet/number marker from each list line so the
 *  template can render the items in its own <ul>. */
function listLines(raw: string): string[] {
  return raw
    .split('\n')
    .map(l => l.replace(/^\s*[-*+]\s+/, '').replace(/^\s*\d+\.\s+/, '').trim())
    .filter(l => l.length > 0)
}

/** Collapse a multi-line paragraph into a single line (the
 *  node body shows a short summary; the full text is still
 *  available via richContent.raw for round-tripping). */
function paragraphText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
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

/** Walk the data tree, calling `visit(node, depth)` for each node.
 *  Depth of the root is 1.  Used by the bulk expand/collapse
 *  toolbar buttons below. */
function walkTreeDepth(visit: (n: MindMapNode, depth: number) => void) {
  const stack: Array<{ n: MindMapNode; depth: number }> = [{ n: dataRef.value, depth: 1 }]
  while (stack.length) {
    const { n, depth } = stack.pop()!
    visit(n, depth)
    // Push children in reverse so the natural left-to-right order
    // is preserved on a depth-first traversal.
    for (let i = n.children.length - 1; i >= 0; i--) {
      stack.push({ n: n.children[i], depth: depth + 1 })
    }
  }
}

/** Collapse every node that has children, leaving only the root
 *  expanded.  Click again to peek at branches. */
function collapseAll() {
  collapsedIds.value = new Set()
  walkTreeDepth((n) => {
    if (n.id !== dataRef.value.id && n.children.length > 0) {
      collapsedIds.value.add(n.id)
    }
  })
  triggerRef()
}

/** Expand only the top-level (level-1) branches.  Every node at
 *  depth >= 2 is collapsed.  Useful for the "鸟瞰" view. */
function expandToLevel(maxDepth: number) {
  collapsedIds.value = new Set()
  walkTreeDepth((n, depth) => {
    if (depth > maxDepth && n.children.length > 0) {
      collapsedIds.value.add(n.id)
    }
  })
  triggerRef()
}

/** Expand every node in the tree. */
function expandAll() {
  collapsedIds.value = new Set()
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
  // A resize drag just finished: skip this click so the user's
  // re-select (in onResizeEnd) sticks.  We always return early
  // because the click target here is the empty canvas (the drag
  // ended outside the node), so there's nothing useful to do.
  if (suppressNextCanvasClick) {
    suppressNextCanvasClick = false
    return
  }
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
  const childDir = child?._dir ?? n._dir
  if (childDir === 'down') {
    // Vertical layout (org mode): line lands on top/bottom mid-edge
    if (side === 'out') return { x: n.x, y: n.y + n.height / 2 }
    return { x: n.x, y: n.y - n.height / 2 }
  }
  // Horizontal (mindmap / tree): line lands on left/right mid-edge
  let d: 1 | -1
  if (side === 'in') d = (-n.side) as 1 | -1
  else if (dir !== undefined) d = dir
  else d = n.side
  // Inset the 'in' anchor a few pixels inside the box so a
  // thick ribbon (especially at high zoom) can't visually
  // pierce the child rectangle — the ribbon's normal-width
  // lands cleanly inside the visible border.
  //
  // For code/table nodes the box's *visible* content (the
  // `.zm-rich` framed body) sits well inside the geometric
  // box edge.  Layout stamps `_richInsetX` with the gap from
  // the box edge to the rich body edge (see layout.ts
  // `buildLayout`); the line tip lands ON the rich body
  // outer left edge, which is what we want — the ribbon
  // visually "touches" the framed body without piercing it.
  // For plain nodes (no rich body) the geometric box edge IS
  // the visible frame, so the default is 0 (line tip on the
  // box edge) — symmetric with the rich-body case so all
  // node types line up at the same horizontal position.
  const inset = side === 'in' ? (n._richInsetX ?? 0) : 0
  return { x: n.x + d * (n.width / 2 - inset), y: n.y }
}

function resetView() {
  const r = layoutResult.value
  panZoom.resetView(r.width, r.height, r.root.y)
}

function runBalance() {
  // 1. apply balanced layout (re-runs the layout computed with
  //    { balanced: true })
  balanced.value = true
  // 2. record this so Ctrl+Z can restore the pre-balance state
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
    triggerRef()
    // Record the new data as the undoable baseline so the first edit
    // after a setData can still be undone.
    record()
    nextTick(() => resetView())
  },
  resetView: () => resetView(),
  exportData,
  importData,
  /** Serialize the current data tree as markdown.  Always available
   *  — the same serializer is used to emit `markdownChange`. */
  getMarkdown: () => mindMapToMarkdown(dataRef.value),
  /** Replace the data tree with the result of parsing `md`.  The
   *  flag `emitMarkdownChange` (default true) controls whether the
   *  change is also echoed via `markdownChange` (use false when
   *  the host just set the same value back from the prop). */
  setMarkdown: (md: string, emitMarkdownChange: boolean = true) => {
    const parsed = markdownToMindMap(md || '')
    if (emitMarkdownChange) usingMarkdown.value = true
    suppressMarkdownEmit = !emitMarkdownChange
    history.reset()
    dataRef.value = clone(parsed)
    selectedId.value = null
    collapsedIds.value = new Set()
    triggerRef()
    record()
    nextTick(() => {
      suppressMarkdownEmit = false
      resetView()
    })
    emit('change', dataRef.value)
  },
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
  applyNodeImage: (id: string, image: MindMapImage) => applyNodeImage(id, image),
  applyNodeImageByUrl: (id: string, url: string) => applyNodeImageByUrl(id, url),
  removeNodeImage: (id: string) => removeNodeImage(id),
  applyNodeLink: (id: string, url: string) => applyNodeLink(id, url),
  removeNodeLink: (id: string) => removeNodeLink(id),
  applyNodeNote: (id: string, text: string) => applyNodeNote(id, text),
  removeNodeNote: (id: string) => removeNodeNote(id),
  applyNodeRichContent: (
    id: string,
    content: { kind: 'code' | 'table'; raw: string; lang?: string } | null
  ) => applyNodeRichContent(id, content),
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
    if (s.branchPaletteId !== undefined) settings.branchPaletteId = s.branchPaletteId
    if (s.customPalettes !== undefined) settings.customPalettes = s.customPalettes
    if (s.lineStyle !== undefined) settings.lineStyle = s.lineStyle
    if (s.taperedEdge !== undefined) settings.taperedEdge = s.taperedEdge
    if (s.showOrderBadge !== undefined) settings.showOrderBadge = s.showOrderBadge
  },
  getSettings: (): MindMapSettings => ({
    autoBalanceOnChange: settings.autoBalanceOnChange,
    lineWidthStart: settings.lineWidthStart,
    lineWidthEnd: settings.lineWidthEnd,
    rainbowBranch: settings.rainbowBranch,
    branchPaletteId: settings.branchPaletteId,
    customPalettes: settings.customPalettes,
    lineStyle: settings.lineStyle,
    layoutMode: settings.layoutMode,
    taperedEdge: settings.taperedEdge,
    showOrderBadge: settings.showOrderBadge,
  }),
  setBranchPalette: (id) => {
    if (!id) return
    const known = [...BUILTIN_PALETTES, ...settings.customPalettes].find((p) => p.id === id)
    if (known) settings.branchPaletteId = id
  },
  getBranchPalette: () => settings.branchPaletteId,
  getBranchPalettes: () => [...BUILTIN_PALETTES, ...settings.customPalettes],
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
  // Record the initial state so the first user action is undoable.
  // Without this, history starts at cursor=-1 and the user can't
  // undo their very first edit (cursor would jump from -1 → 0, and
  // canUndo() requires cursor > 0).
  record()
  nextTick(() => resetView())
})

// re-center when layout dimensions change
// NB: there used to be a `watch(() => layoutResult.value.width, …)`
// that auto-reset the view whenever the layout's overall width
// changed.  It was meant to keep newly-imported data visible, but
// it also fired on EVERY drag (the dragged subtree changes
// vbW) and on every collapse / expand — which silently undid the
// user's zoom + pan.  Callers that need a fresh view already
// trigger it themselves: setData / importData / runBalance /
// onMounted all call resetView() explicitly.
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
      @mouseenter="canvasHovered = true"
      @mouseleave="canvasHovered = false"
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
            'has-image': !!n.image,
            'is-resizing': resizingId === n.id,
          }"
          :style="{
            left: n.x + 'px',
            top: n.y + 'px',
            // Pin the box to the layout's reserved width so the
            // SVG edge anchor (which keys off n.width) lands on
            // the visible centre.  Without `width` here the box
            // would grow to fit the rich body's `width: max-content`
            // and the line would pierce the visible frame.
            width: n.width + 'px',
            minWidth: n.width + 'px',
            height: n.height + 'px',
            fontSize: n.fontSize + 'px',
            background: nodeBg(n),
            color: nodeFg(n),
            borderColor: nodeBorder(n),
            fontWeight: nodeFontWeight(n),
            // Center the box on (x, y) with translate(-50%, -50%)
            transform: `translate(-50%, -50%)`,
          }"
          @click="(e) => onNodeClick(e, n)"
          @dblclick="(e) => { e.stopPropagation(); if (!previewMode) startEdit(n.id) }"
          @contextmenu="(e) => onNodeContextMenu(e, n)"
          @mouseenter="onNodeMouseEnter(n.id)"
          @mouseleave="onNodeMouseLeave(n.id)"
        >
          <img
            v-if="n.image"
            class="zm-node-img"
            :src="n.image.src"
            :width="n.image.width"
            :height="n.image.height"
            :alt="n.text"
            draggable="false"
          />
          <!--
            Rich body (code / table only): produced by hand-built
            trees (the `#rich` sample in the demo) or by
            `markdownToRichMindMap`.  Rendered as a small framed
            block ABOVE the node title so the title stays
            single-line and the SVG edge anchor (which keys
            off the box centre) doesn't drift.  Only code and
            table kinds render — paragraph / list kinds fall
            through to the plain `text` label so the box
            stays the same size as a regular node.
            Pointer events are disabled on the body so clicks
            fall through to the node (lets the user dblclick
            to edit).
          -->
          <div
            v-if="n.richContent && (n.richContent.kind === 'code' || n.richContent.kind === 'table') && editingId !== n.id"
            class="zm-rich zm-rich-above"
            :class="{ 'zm-rich-no-overflow': n.richContent.kind === 'table' || n.richContent.kind === 'code' }"
            @click.stop
            @dblclick.stop="startRichEdit(n.id)"
            @mousedown.stop
          >
            <!-- Edit mode: textarea overlays the preview, same size. -->
            <textarea
              v-if="richEditingId === n.id"
              v-model="richEditDraft"
              class="zm-rich-edit"
              spellcheck="false"
              @blur="commitRichEdit"
              @keydown="onRichEditKeydown"
            />
            <template v-else>
              <pre
                v-if="n.richContent.kind === 'code'"
                class="zm-rich-code"
              ><code v-html="highlightCode(stripCodeFence(n.richContent.raw), codeLang(n.richContent.raw))"></code></pre>
              <table
                v-else-if="n.richContent.kind === 'table'"
                class="zm-rich-table"
              >
                <tbody>
                  <tr v-for="(row, ri) in sortedTableRows(n.id, tableRows(n.richContent.raw))" :key="ri">
                    <th
                      v-if="ri === 0"
                      v-for="(cell, ci) in row"
                      :key="`h${ci}`"
                      class="zm-rich-table-sort"
                      :class="{
                        'is-sorted': sortState.get(n.id)?.col === ci,
                        'is-asc': sortState.get(n.id)?.col === ci && sortState.get(n.id)?.dir === 'asc',
                        'is-desc': sortState.get(n.id)?.col === ci && sortState.get(n.id)?.dir === 'desc',
                      }"
                      @click.stop="toggleNodeSort(n.id, ci)"
                    >
                      <span>{{ cell }}</span>
                      <span class="zm-rich-sort-mark" aria-hidden="true">{{ sortMark(n.id, ci) }}</span>
                    </th>
                    <td
                      v-else
                      v-for="(cell, ci) in row"
                      :key="`c${ci}`"
                    >{{ cell }}</td>
                  </tr>
                </tbody>
              </table>
            </template>
          </div>
          <span v-if="editingId !== n.id" class="zm-text">
            <span class="zm-text-label">{{ n.text }}</span>
            <a
              v-if="n.link && !editingId"
              class="zm-node-link"
              :href="n.link.url"
              target="_blank"
              rel="noopener noreferrer"
              :title="`打开链接：${n.link.url}`"
              @click.stop
              @mousedown.stop
            ><Icon name="link" :size="11" :stroke="2" /></a>
            <button
              v-if="n.note && !editingId"
              class="zm-node-note-btn"
              type="button"
              :title="notePreview(n.note.text)"
              @click.stop="emitEditNote(n.id)"
              @mousedown.stop
            ><Icon name="note" :size="11" :stroke="2" /></button>
          </span>
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
            :style="{ background: branchColor.get(n.id) ?? '#64748b' }"
            :title="`展开 ${collapsedChildCount(n.id)} 个子节点`"
            @mousedown.stop
            @click.stop="toggleCollapse(n.id)"
          >{{ collapsedChildCount(n.id) }}</span>

          <button
            v-if="!n.isRoot && nodeHasChildren(n) && !isCollapsed(n.id)"
            class="zm-btn zm-collapse"
            :class="{ 'is-on-left': n.side === -1 }"
            :style="{ color: branchColor.get(n.id) ?? '#64748b', borderColor: branchColor.get(n.id) ?? '#64748b' }"
            title="折叠"
            @mousedown.stop
            @click.stop="toggleCollapse(n.id)"
          >
            <Icon name="minus" :size="10" :stroke="2.4" />
          </button>

          <!-- Resize handle — bottom-right corner of the node,
               only on selected image-bearing nodes.  Drag to
               scale the image.  Inline handlers update the DOM
               directly for drag-time fluidity; mouseup commits
               the new size to the data tree. -->
          <span
            v-if="n.image && selectedId === n.id && editingId !== n.id"
            class="zm-img-resize-handle"
            title="拖动调整图片大小"
            @mousedown.stop="(e) => onResizeStart(e, n)"
          />

          <!-- "Remove image" tiny × button.  Sits a couple of
               pixels above the resize handle.  Clears the
               image field and re-runs the layout. -->
          <button
            v-if="n.image && selectedId === n.id && editingId !== n.id"
            class="zm-img-remove-btn"
            title="移除图片"
            @mousedown.stop
            @click.stop="removeNodeImage(n.id)"
          >
            <Icon name="x" :size="9" :stroke="2.2" />
          </button>
        </div>
      </div>

      <!-- Floating context menu — mounted only while the user is
           interacting with it.  Container is the canvas so the
           menu can clamp itself inside the visible area. -->
      <NodeContextMenu
        v-if="contextMenu"
        :x="contextMenu.x"
        :y="contextMenu.y"
        :container="wrapperRef"
        :has-image="!!findNode(dataRef, contextMenu.nodeId)?.image"
        :has-link="!!findNode(dataRef, contextMenu.nodeId)?.link"
        :has-note="!!findNode(dataRef, contextMenu.nodeId)?.note"
        :has-code="findNode(dataRef, contextMenu.nodeId)?.richContent?.kind === 'code'"
        :has-table="findNode(dataRef, contextMenu.nodeId)?.richContent?.kind === 'table'"
        @pick-image="menuPickImage"
        @remove-image="menuRemoveImage"
        @set-link="menuSetLink"
        @remove-link="menuRemoveLink"
        @edit-note="menuEditNote"
        @remove-note="menuRemoveNote"
        @add-code="menuAddCode"
        @edit-code="menuAddCode"
        @remove-code="menuRemoveCode"
        @add-table="menuAddTable"
        @edit-table="menuAddTable"
        @remove-table="menuRemoveTable"
        @close="closeContextMenu"
      />
    </div>

    <!-- Bottom toolbar.  Always rendered; the parent's previewMode
         + canvasHovered refs drive visibility:
           - non-preview: toolbar always visible
           - preview:     toolbar fades in on canvas hover, fades
                          out on leave.  Pointer-events follow
                          opacity so the toolbar doesn't catch
                          clicks while invisible.
         Inside, the "secondary" group (add child/sibling, layout
         mode, import) is non-preview-only — those buttons mutate
         data, which preview mode disallows. -->
    <div
      class="zm-toolbar"
      :class="{ 'is-preview-only': props.previewMode, 'is-hovered': canvasHovered }"
    >
      <!-- 缩放比例 + 放大 / 缩小 / 重置视图: always visible, also
           show in preview mode (the canvas still needs to be
           navigable in preview). -->
      <span class="zm-tb-tip zm-tb-zoom">{{ Math.round(panZoom.scale.value * 100) }}%</span>
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

      <!-- Bulk expand/collapse: safe in preview mode (it's a view
           operation, not an edit).  Visually they're the same in
           both modes. -->
      <button class="zm-tb-btn" title="全部收起" @click="collapseAll">
        <Icon name="collapse" />
      </button>
      <button class="zm-tb-btn" title="展开一级" @click="expandToLevel(1)">
        <Icon name="expand" />
      </button>
      <button class="zm-tb-btn" title="展开二级" @click="expandToLevel(2)">
        <Icon name="expand" />
      </button>
      <button class="zm-tb-btn" title="全部展开" @click="expandAll">
        <Icon name="expand" />
      </button>
      <span class="zm-tb-divider" />

      <!-- 导出: safe in preview (just serializes the current data). -->
      <button class="zm-tb-btn" title="导出 JSON" @click="exportToFile">
        <Icon name="export" />
      </button>

      <!-- Non-preview-only: edit + layout + import.  These mutate
           the data tree or settings, which preview mode disallows. -->
      <template v-if="!props.previewMode">
        <span class="zm-tb-divider" />
        <button
          class="zm-tb-btn"
          title="添加子节点 (Tab)"
          @click="selectedId && doAddChild(selectedId)"
        >
          <img :src="addSubNodeIcon" width="14" height="14" alt="添加子节点" draggable="false" />
        </button>
        <button
          class="zm-tb-btn"
          title="添加同级 (Enter)"
          @click="selectedId && doAddSibling(selectedId)"
        >
          <img :src="addNodeIcon" width="14" height="14" alt="添加同级" draggable="false" />
        </button>
        <span class="zm-tb-divider" />
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
          class="zm-tb-btn"
          title="导入 JSON"
          @click="importFromFile"
        >
          <Icon name="import" />
        </button>
      </template>
    </div>
  </div>
</template>

<style>
@import 'highlight.js/styles/github.css';

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
  flex-direction: column;  /* Stack rich body (image / code / table) above title.
                            * When there's no rich body the column only has the
                            * title row, which is centered horizontally and
                            * vertically (justify-content: center on the
                            * cross axis). */
  align-items: center;
  justify-content: center;
  padding: 0 0.8em;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid;
  line-height: 1.2;
  cursor: default;
  transition: box-shadow 0.15s;
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
  /* The text span now hosts the text label + inline link/note
   * icons.  `pointer-events: none` is kept on the *label* so a
   * click on text still falls through to the node (lets the
   * user dblclick-to-edit the text).  The icon buttons inside
   * re-enable pointer events explicitly.
   *
   * `display: flex` (not inline-flex): the parent `.zm-node` is
   * `display: flex; flex-direction: column; align-items: center`,
   * and an inline-flex child reports its content size to the
   * parent as ~0 height (the inline formatting context doesn't
   * contribute a line-box here), which collapsed the title to a
   * 0-height strip and clipped the visible text.
   *
   * `min-height: 1em` (belt-and-braces): a flex item's default
   * `min-height: auto` resolves to the content's min-content
   * size, which for an inline-element child can still be 0 if
   * the parent has tight overflow constraints.  Forcing `1em`
   * guarantees the title takes at least one line-box's worth
   * of vertical space so the text is never clipped by the
   * parent box.  The actual `n.height` reservation in
   * `calcNodeSize` accounts for this 1em too. */
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  /* Force the title row to reserve at least one line-box's
   * worth of vertical space.  A flex item's default
   * `min-height: auto` resolves to its content's min-content
   * size, which for an inline-element child of an
   * overflow-constrained flex parent can be 0.  Using
   * `min-height: 1.2em` (matching the parent's line-height)
   * guarantees the title takes the full line-box height so
   * `align-items: center` never clips a taller label.  The
   * layout's `n.height` reservation accounts for this. */
  min-height: 1.2em;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zm-text-label {
  pointer-events: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* Allow flex to shrink the label so a long string doesn't push
   * the rendered width past the layout's reserved width (which
   * would pull the line anchor off the box edge).  `min-width: 0`
   * is the standard flex-shrink escape hatch. */
  min-width: 0;
  flex-shrink: 1;
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

/* ── rich body ─────────────────────────────────────
 * Shows the markdown payload produced by
 * `markdownToRichMindMap` (or hand-built data) inside the
 * node box, above the title for code/table kinds so the
 * single-line title stays visually centred and the SVG
 * edge anchor doesn't drift.  Pointer events are
 * explicitly disabled via .zm-rich so the node stays
 * clickable for selection / dblclick-to-edit. */
.zm-rich {
  /* The body is editable in place: dblclick flips to a
   * textarea, clickable sort headers in tables.  We stop click
   * propagation in the template so a click on the body doesn't
   * also re-select the node. */
  margin-top: 6px;
  width: max-content;
  /* No height cap: the body grows to fit its content so very long
   * tables / code stay fully visible.  The box's layout-reserved
   * height comes from the measured `richHeights` map (see
   * core/layout.ts), so neighbours don't collide when a table
   * grows.  If you want a safety bound for pathological pastes,
   * add `max-height` here and switch `overflow` back to `auto`. */
  overflow: visible;
  font-size: 0.78em;
  line-height: 1.35;
  text-align: left;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 4px;
  padding: 4px 6px;
  color: inherit;
}
/* When the rich body sits above the title, drop the top
 * margin (no need to separate from a thing that doesn't
 * exist yet) and add a bottom gap before the title. */
.zm-rich-above {
  margin: 0 0 2px 0;
}
/* Both code and table rich bodies grow with their content and
 * never show a scrollbar — the layout's reserved height cap
 * (`richHeights` cap in core/layout.ts) is the only upper bound.
 * Letting the body take its natural height keeps the rendered
 * box in sync with the layout's reservation. */
.zm-rich-no-overflow {
  max-height: none;
  overflow: visible;
}
.zm-rich-code {
  margin: 0;
  padding: 6px 8px;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  font-size: 0.92em;
  white-space: pre-wrap;
  word-break: break-word;
  /* Lifts the code off the node's coloured surface so it
   * stays legible regardless of branch palette.  The
   * translucent white mixes with the node background. */
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid currentColor;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}
.zm-rich-list {
  margin: 0;
  padding-left: 1.2em;
  list-style: disc;
}
.zm-rich-list li {
  margin: 1px 0;
}
/* Tables should grow with their content and never show a
 * scrollbar — the only thing the layout reserved height
 * gave them was a cap to keep the tree readable.  A short
 * 3-4 row table that fits within the reserved space should
 * just be its natural height. */
.zm-rich-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.92em;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid currentColor;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}
.zm-rich-table td {
  border-top: 1px solid currentColor;
  border-right: 1px solid currentColor;
  padding: 3px 6px;
  /* Higher than the old 0.7 so cell text reads cleanly against
   * the translucent white fill, but still tinted to the branch
   * palette via currentColor. */
  opacity: 0.9;
}
.zm-rich-table tr:last-child td {
  border-bottom: none;
}
.zm-rich-table td:last-child {
  border-right: none;
}
.zm-rich-table-sort {
  position: relative;
  background: rgba(255, 255, 255, 0.4);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  user-select: none;
  padding: 3px 6px;
  border-bottom: 1px solid currentColor;
  border-right: 1px solid currentColor;
  /* The parent .zm-rich has pointer-events: none so clicks fall
   * through to the node; re-enable here so sort actually works. */
  pointer-events: auto;
}
.zm-rich-table-sort:last-child {
  border-right: none;
}
.zm-rich-table-sort:hover {
  background: rgba(255, 255, 255, 0.65);
}
.zm-rich-table-sort.is-sorted {
  background: rgba(255, 255, 255, 0.7);
}
.zm-rich-sort-mark {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 9px;
  color: #94a3b8;
}
.zm-rich-table-sort.is-sorted .zm-rich-sort-mark {
  color: #1d4ed8;
}
.zm-rich-edit {
  width: 100%;
  min-height: 90px;
  margin: 0;
  padding: 4px 6px;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  font-size: 0.92em;
  line-height: 1.4;
  color: inherit;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid currentColor;
  border-radius: 3px;
  outline: none;
  resize: vertical;
  white-space: pre;
  box-sizing: border-box;
}
.zm-rich-edit:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}
.zm-rich-paragraph {
  white-space: pre-wrap;
  word-break: break-word;
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
   * Border + icon colour come inline from the node's rainbow branch
   * hue (or grey when rainbow is off); the background is opaque
   * white so the button reads cleanly against any node fill. */
  right: -8px;
  top: 50%;
  width: 14px;
  height: 14px;
  background: #ffffff;
  border: 1.5px solid;
  transform: translateY(-50%);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.18);
}
.zm-collapse.is-on-left {
  right: auto;
  left: -8px;
}
.zm-collapse:hover {
  transform: translateY(-50%) scale(1.15);
  background: #ffffff;
}
/* xmind-style collapsed child-count badge.  Sits on the line-out
 * side of the node (right edge for right-side nodes, left edge for
 * left-side), vertically centered.  Click to expand.  Background
 * colour is set inline from the node's rainbow branch hue. */
.zm-collapse-badge {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  left: calc(100% + 8px);
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 5px;
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  user-select: none;
  z-index: 2;
  transition: filter 0.1s;
}
.zm-collapse-badge.is-on-left {
  left: auto;
  right: calc(100% + 8px);
}
.zm-collapse-badge:hover {
  filter: brightness(0.9);
}

/* Has-image layout — switch the node from a row (text-only) to a
 * column (image on top, text below).  Keep both centered so the
 * box still looks like a chip. */
.zm-node.has-image {
  flex-direction: column;
  padding: 8px;
  gap: 6px;
  white-space: normal;
}
.zm-node-img {
  display: block;
  /* Sized by attributes; live-drag override sets style.width /
   * style.height directly.  pointer-events:none so the image
   * never eats a click that should select the node or enter
   * edit mode. */
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
  object-fit: contain;
  border-radius: 4px;
}

/* Inline link / note icons that sit next to the node's text.
 * They inherit the node's text color and sit at 14×14 so they
 * match the text's optical weight.  pointer-events is re-enabled
 * on the icons because the parent .zm-text disables it. */
.zm-node-link,
.zm-node-note-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: currentColor;
  border-radius: 3px;
  cursor: pointer;
  flex-shrink: 0;
  text-decoration: none;
  opacity: 0.75;
  transition: opacity 0.1s, background 0.1s;
  /* Inherit pointer-events from the node (the parent .zm-text has
   * pointer-events: none; the icons need clicks). */
  pointer-events: auto;
}
.zm-node-link:hover,
.zm-node-note-btn:hover {
  opacity: 1;
  background: rgba(15, 23, 42, 0.08);
}
.zm-node-link svg,
.zm-node-note-btn svg {
  display: block;
}

/* Resize handle — small square in the bottom-right of the
 * selected image node.  Always 10×10 in screen space, regardless
 * of zoom (user expects a 10px grab target).  Cursor changes to
 * nwse-resize to telegraph the drag direction. */
.zm-img-resize-handle {
  position: absolute;
  right: -5px;
  bottom: -5px;
  width: 10px;
  height: 10px;
  background: #ffffff;
  border: 1.5px solid #3b82f6;
  border-radius: 2px;
  cursor: nwse-resize;
  z-index: 4;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
}
.zm-node.is-resizing {
  cursor: nwse-resize !important;
}

/* "Remove image" tiny × — sits a bit above the resize handle. */
.zm-img-remove-btn {
  position: absolute;
  right: -5px;
  bottom: 14px;
  width: 14px;
  height: 14px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #64748b;
  padding: 0;
  z-index: 4;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
}
.zm-img-remove-btn:hover {
  background: #fee2e2;
  color: #b91c1c;
  border-color: #fca5a5;
}

/* Inline note editor removed in commit 0ec… — the note editor
 * now lives in the right-side drawer (NotePanel.vue).  Keep
 * the section header commented for archaeology. */

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
  transition: opacity 0.18s ease, transform 0.18s ease;
}
/* In preview mode the toolbar is hidden by default and fades in
   on canvas hover.  We also nudge it down a bit so the entrance
   is a small slide, not a hard pop.  Pointer-events follow
   opacity so the invisible toolbar never intercepts clicks. */
.zm-toolbar.is-preview-only {
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%) translateY(8px);
}
.zm-toolbar.is-preview-only.is-hovered {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(-50%) translateY(0);
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
.zm-tb-btn img {
  /* The bundled SVGs use a hardcoded mid-grey fill.  Tint
   * them toward the active text color so the icon visibly
   * responds to the parent button's hover state. */
  filter: invert(20%) sepia(15%) saturate(500%) hue-rotate(180deg);
  transition: filter 0.1s;
}
.zm-tb-btn:hover img {
  filter: invert(15%) sepia(30%) saturate(800%) hue-rotate(180deg);
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
