<script setup lang="ts">
import { computed, ref, nextTick, onBeforeUnmount } from 'vue'
import type { MindMapNode } from '../types'
// Vite ?url gives a stable asset URL we can pass to <img src=…>.
// The buttons stay styled by .zm-outline-row-action, the image
// just replaces the inline <svg> we used to draw by hand.
import addNodeIcon from '../assets/svg/add-node.svg?url'
import addSubNodeIcon from '../assets/svg/add-sub-node.svg?url'

const props = withDefaults(
  defineProps<{
    /** Root of the mind map. */
    data: MindMapNode
    /** Highlight the node with this id (the one selected on the main canvas). */
    selectedId?: string | null
    /** When true, hide a node's children in the outline. */
    collapsedIds?: Set<string>
    /** Read-only — disables editing / add / drag.  Default false. */
    readonly?: boolean
  }>(),
  { selectedId: null, collapsedIds: () => new Set<string>(), readonly: false }
)

const emit = defineEmits<{
  (e: 'select', node: MindMapNode): void
  (e: 'toggleCollapse', id: string): void
  /** Inline edit finished (Enter / blur).  text may equal the old value. */
  (e: 'edit', payload: { id: string; text: string }): void
  /** Add a new child under the given node. */
  (e: 'addChild', id: string): void
  /** Add a new sibling after the given node. */
  (e: 'addSibling', id: string): void
  /** Drag-and-drop a node to a new location. */
  (e: 'move', payload: { srcId: string; targetId: string; position: 'before' | 'after' | 'child' }): void
}>()

interface FlatRow {
  id: string
  text: string
  depth: number
  /** Zero-based position among the parent's children — used to label
   *  rows with `1., 2., 3., …` for orientation.  Root is always 0. */
  siblingIndex: number
  hasChildren: boolean
  collapsed: boolean
  node: MindMapNode
}

const rows = computed<FlatRow[]>(() => {
  const out: FlatRow[] = []
  const walk = (n: MindMapNode, depth: number, siblingIndex: number) => {
    const hasChildren = n.children.length > 0
    const collapsed = props.collapsedIds.has(n.id)
    out.push({
      id: n.id,
      text: n.text || '(无标题)',
      depth,
      siblingIndex,
      hasChildren,
      collapsed,
      node: n,
    })
    if (hasChildren && !collapsed) {
      n.children.forEach((c, i) => walk(c, depth + 1, i))
    }
  }
  walk(props.data, 0, 0)
  return out
})

// --------------------------------------------------------------------
// Inline edit state
// --------------------------------------------------------------------
const editingId = ref<string | null>(null)
const editingText = ref('')
let editInputEl: HTMLInputElement | null = null

function startEdit(row: FlatRow) {
  if (props.readonly) return
  editingId.value = row.id
  editingText.value = row.text
  nextTick(() => {
    editInputEl = document.querySelector('.zm-outline-input') as HTMLInputElement | null
    editInputEl?.focus()
    editInputEl?.select()
  })
}

function commitEdit() {
  if (editingId.value == null) return
  emit('edit', { id: editingId.value, text: editingText.value.trim() || '(无标题)' })
  cancelEdit()
}

function cancelEdit() {
  editingId.value = null
  editingText.value = ''
  editInputEl = null
}

function onEditKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitEdit()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
  }
}

onBeforeUnmount(cancelEdit)

// --------------------------------------------------------------------
// Drag-and-drop — drag a row, drop on another row's top half (before),
// bottom half (after), or right (child).  Visual hint: row highlights
// blue when a drag is hovering.
// --------------------------------------------------------------------
type DragPayload = { id: string; text: string }
const dragData = ref<DragPayload | null>(null)
const dragOverId = ref<string | null>(null)
const dragOverPos = ref<'before' | 'after' | 'child' | null>(null)

function onDragStart(e: DragEvent, row: FlatRow) {
  if (props.readonly) {
    e.preventDefault()
    return
  }
  dragData.value = { id: row.id, text: row.text }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // text/plain is the only type that's reliably set across browsers;
    // the actual id is in dragData.
    e.dataTransfer.setData('text/plain', row.id)
  }
}

function onDragEnd() {
  dragData.value = null
  dragOverId.value = null
  dragOverPos.value = null
}

function onDragOver(e: DragEvent, row: FlatRow) {
  if (!dragData.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  const pos = dropPositionFor(e, row)
  dragOverId.value = row.id
  dragOverPos.value = pos
}

function onDragLeave(row: FlatRow) {
  if (dragOverId.value === row.id) {
    dragOverId.value = null
    dragOverPos.value = null
  }
}

function onDrop(e: DragEvent, row: FlatRow) {
  e.preventDefault()
  const src = dragData.value
  if (!src) return
  const pos = dropPositionFor(e, row)
  if (src.id !== row.id) {
    emit('move', { srcId: src.id, targetId: row.id, position: pos })
  }
  onDragEnd()
}

/** Decide if a drop is 'before' / 'after' / 'child' based on cursor
 *  position within the row.  Top 30% → before, bottom 30% → after,
 *  middle 40% + an indent shift to the right → child. */
function dropPositionFor(e: DragEvent, row: FlatRow): 'before' | 'after' | 'child' {
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const y = e.clientY - rect.top
  const h = rect.height
  if (y < h * 0.3) return 'before'
  if (y > h * 0.7) return 'after'
  return 'child'
}

// --------------------------------------------------------------------
// Outline copy / paste from before, kept for compat
// --------------------------------------------------------------------
const copiedId = ref<string | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } finally {
      document.body.removeChild(ta)
    }
    return ok
  }
}

async function copyNodeText(e: MouseEvent, text: string, id: string) {
  e.stopPropagation()
  const ok = await copyText(text)
  if (!ok) return
  copiedId.value = id
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => (copiedId.value = null), 1200)
}

const plainText = computed(() => {
  const lines: string[] = []
  const walk = (n: MindMapNode, depth: number) => {
    const indent = '  '.repeat(depth)
    const bullet = depth === 0 ? '' : '- '
    lines.push(indent + bullet + (n.text || ''))
    for (const c of n.children) walk(c, depth + 1)
  }
  walk(props.data, 0)
  return lines.join('\n')
})

const copyingOutline = ref(false)
let outlineTimer: ReturnType<typeof setTimeout> | null = null

async function copyOutline() {
  const ok = await copyText(plainText.value)
  if (!ok) return
  copyingOutline.value = true
  if (outlineTimer) clearTimeout(outlineTimer)
  outlineTimer = setTimeout(() => (copyingOutline.value = false), 1200)
}
</script>

<template>
  <div class="zm-outline-root">
    <div class="zm-outline-actions">
      <button
        class="zm-outline-action-btn"
        :class="{ 'is-success': copyingOutline }"
        title="复制完整大纲为纯文本"
        @click="copyOutline"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect v-if="!copyingOutline" x="9" y="9" width="13" height="13" rx="2" />
          <path v-else d="M5 12 L10 17 L19 7" />
          <path d="M5 15 H4 a2 2 0 0 1 -2 -2 V4 a2 2 0 0 1 2 -2 h9 a2 2 0 0 1 2 2 v1" />
        </svg>
        <span>{{ copyingOutline ? '已复制' : '复制大纲' }}</span>
      </button>
    </div>
    <ul class="zm-outline">
      <li
        v-for="row in rows"
        :key="row.id"
        class="zm-outline-row"
        :class="{
          'is-selected': row.id === selectedId,
          'is-root': row.depth === 0,
          'is-editing': editingId === row.id,
          'is-drag-over-before': dragOverId === row.id && dragOverPos === 'before',
          'is-drag-over-after': dragOverId === row.id && dragOverPos === 'after',
          'is-drag-over-child': dragOverId === row.id && dragOverPos === 'child',
        }"
        :style="{ paddingLeft: 12 + row.depth * 16 + 'px' }"
        draggable="true"
        @click="emit('select', row.node)"
        @dblclick="startEdit(row)"
        @dragstart="(e) => onDragStart(e, row)"
        @dragend="onDragEnd"
        @dragover="(e) => onDragOver(e, row)"
        @dragleave="() => onDragLeave(row)"
        @drop="(e) => onDrop(e, row)"
      >
        <button
          v-if="row.hasChildren"
          class="zm-outline-toggle"
          :title="row.collapsed ? '展开' : '折叠'"
          @click.stop="emit('toggleCollapse', row.id)"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline v-if="!row.collapsed" points="6 9 12 15 18 9" />
            <polyline v-else points="9 6 15 12 9 18" />
          </svg>
        </button>
        <span v-else class="zm-outline-dot" />
        <span class="zm-outline-index">{{ row.siblingIndex + 1 }}.</span>
        <input
          v-if="editingId === row.id"
          v-model="editingText"
          class="zm-outline-input"
          @blur="commitEdit"
          @keydown="onEditKeydown"
          @click.stop
        />
        <span v-else class="zm-outline-text">{{ row.text }}</span>
        <button
          v-if="!props.readonly"
          class="zm-outline-row-action"
          title="添加同级"
          @click.stop="emit('addSibling', row.id)"
        >
          <img :src="addNodeIcon" width="14" height="14" alt="添加同级" draggable="false" />
        </button>
        <button
          v-if="!props.readonly"
          class="zm-outline-row-action"
          title="添加子节点"
          @click.stop="emit('addChild', row.id)"
        >
          <img :src="addSubNodeIcon" width="14" height="14" alt="添加子节点" draggable="false" />
        </button>
        <button
          class="zm-outline-row-copy"
          :class="{ 'is-success': copiedId === row.id }"
          :title="copiedId === row.id ? '已复制' : '复制节点文本'"
          @click="(e) => copyNodeText(e, row.text, row.id)"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect v-if="copiedId !== row.id" x="9" y="9" width="13" height="13" rx="2" />
            <path v-else d="M5 12 L10 17 L19 7" />
            <path d="M5 15 H4 a2 2 0 0 1 -2 -2 V4 a2 2 0 0 1 2 -2 h9 a2 2 0 0 1 2 2 v1" />
          </svg>
        </button>
      </li>
    </ul>
  </div>
</template>

<style>
.zm-outline-root {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.zm-outline-actions {
  display: flex;
  justify-content: flex-end;
  padding: 8px 10px 4px;
  flex-shrink: 0;
}
.zm-outline-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  font-size: 11px;
  font-family: inherit;
  color: #64748b;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.1s;
}
.zm-outline-action-btn:hover {
  background: #f1f5f9;
  color: #1e293b;
  border-color: #cbd5e1;
}
.zm-outline-action-btn.is-success {
  background: #ecfdf5;
  color: #047857;
  border-color: #a7f3d0;
}
.zm-outline {
  list-style: none;
  margin: 0;
  padding: 4px 0 8px;
  font-size: 13px;
  overflow: auto;
  flex: 1;
  min-height: 0;
}
.zm-outline-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 6px;
  padding-top: 4px;
  padding-bottom: 4px;
  cursor: grab;
  color: #334155;
  border-radius: 4px;
  margin: 0 6px;
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 0.1s;
  position: relative;
}
.zm-outline-row:active {
  cursor: grabbing;
}
.zm-outline-row:hover {
  background: #f1f5f9;
}
.zm-outline-row.is-root {
  font-weight: 600;
  color: #0f172a;
}
.zm-outline-row.is-selected {
  background: #eff6ff;
  color: #1d4ed8;
}
.zm-outline-row.is-selected .zm-outline-toggle,
.zm-outline-row.is-selected .zm-outline-dot,
.zm-outline-row.is-selected .zm-outline-row-copy,
.zm-outline-row.is-selected .zm-outline-row-action {
  color: #1d4ed8;
}
.zm-outline-row.is-drag-over-before::before,
.zm-outline-row.is-drag-over-after::after {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  height: 2px;
  background: #3b82f6;
  border-radius: 1px;
  pointer-events: none;
}
.zm-outline-row.is-drag-over-before::before { top: 0; }
.zm-outline-row.is-drag-over-after::after { bottom: 0; }
.zm-outline-row.is-drag-over-child {
  background: #dbeafe !important;
  outline: 2px solid #3b82f6;
  outline-offset: -2px;
}
.zm-outline-toggle {
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 3px;
  flex-shrink: 0;
  padding: 0;
}
.zm-outline-toggle:hover {
  background: #e2e8f0;
  color: #475569;
}
.zm-outline-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #cbd5e1;
  flex-shrink: 0;
  margin: 0 6px;
}
.zm-outline-index {
  font-size: 11px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
  min-width: 22px;
  flex-shrink: 0;
  user-select: none;
}
.zm-outline-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.zm-outline-input {
  flex: 1;
  font: inherit;
  font-size: 13px;
  color: inherit;
  background: #ffffff;
  border: 1px solid #3b82f6;
  border-radius: 3px;
  padding: 1px 4px;
  margin: -2px 0;
  outline: none;
}
.zm-outline-row-action {
  width: 20px;
  height: 20px;
  border: 1px solid transparent;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  border-radius: 4px;
  flex-shrink: 0;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.1s, background 0.1s, color 0.1s, border-color 0.1s;
}
.zm-outline-row:hover .zm-outline-row-action,
.zm-outline-row.is-selected .zm-outline-row-action {
  opacity: 1;
}
.zm-outline-row-action:hover {
  background: #e0e7ff;
  color: #4338ca;
  border-color: #c7d2fe;
}
.zm-outline-row-action img {
  /* The bundled SVGs use a hardcoded mid-grey fill.  Tint
   * them toward the active color on hover so the icon
   * actually responds to the parent button's hover state. */
  filter: invert(38%) sepia(94%) saturate(2417%) hue-rotate(229deg) brightness(91%) contrast(91%);
}
.zm-outline-row-copy {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 3px;
  flex-shrink: 0;
  padding: 0;
  opacity: 0;
  transition: opacity 0.1s, background 0.1s, color 0.1s;
}
.zm-outline-row:hover .zm-outline-row-copy,
.zm-outline-row.is-selected .zm-outline-row-copy {
  opacity: 1;
}
.zm-outline-row-copy:hover {
  background: #e2e8f0;
  color: #475569;
}
.zm-outline-row-copy.is-success {
  opacity: 1;
  color: #047857;
  background: #ecfdf5;
}
</style>
