<script setup lang="ts">
/**
 * Node panel — body of the right-side drawer.  Renders every
 * payload of the selected node, each section is editable:
 *
 *   1. note  — editable textarea
 *   2. link  — URL input (display: chip; click to expand)
 *   3. image — URL input + live preview
 *   4. code  — textarea (raw markdown) with a syntax-highlighted
 *              preview that re-renders as the user types
 *   5. table — CSV-ish textarea with a live preview; column
 *              headers in the preview are clickable to sort the
 *              rows (asc → desc → off, doesn't write back to raw)
 *
 * Sections that aren't set on the selected node are hidden, so
 * the panel collapses to just the note when nothing else exists.
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { MindMapNode } from '../types'
import { useAutosize } from '../composables/useAutosize'
import {
  codeLang,
  highlightCode,
  rowsToTable,
  sortTable,
  stripCodeFence,
  tableRows,
  type SortDir,
} from '../composables/useRichContent'
import { renderMarkdown } from '../composables/useMarkdown'

const props = defineProps<{
  /** The currently selected node.  `null` means nothing is
   *  selected; the panel renders an empty-state in that case. */
  selectedNode: MindMapNode | null
  /** Disable all edit controls (read-only mode). */
  readonly?: boolean
  /** Bumped by the parent (App.vue) on each select change.  The
   *  panel uses this as a "focus the textarea" signal so the
   *  user can start typing immediately after picking a node. */
  focusTick?: number
}>()

const emit = defineEmits<{
  /** Note edit committed (blur / Ctrl+Enter).  Empty string clears it. */
  (e: 'apply', text: string): void
  /** Note removed. */
  (e: 'remove'): void
  /** Link URL edited (empty string removes the link). */
  (e: 'set-link', url: string): void
  /** Image src edited (empty string removes the image). */
  (e: 'set-image', src: string): void
  /** Rich body (code / table) raw markdown edited.  Pass the
   *  whole `richContent` payload so the parent can refresh the
   *  kind + lang tag too; pass `null` to remove the body. */
  (
    e: 'set-rich',
    payload: { kind: 'code' | 'table'; raw: string; lang?: string } | null
  ): void
}>()

// ---------------------------------------------------------------------------
// Note (the only always-editable field).  The textarea holds the
// raw markdown; the preview pane below re-renders it via
// `renderMarkdown` on every keystroke.  `showPreview` lets the
// user collapse the preview to give the textarea more room.
// ---------------------------------------------------------------------------
const draft = ref('')
const noteRef = ref<HTMLTextAreaElement | null>(null)
useAutosize(noteRef, { minRows: 4, maxRows: 10 })
const isEmpty = computed(() => !draft.value || draft.value.trim() === '')
const noteHtml = computed(() => renderMarkdown(draft.value))
const showPreview = ref(true)
function togglePreview() {
  showPreview.value = !showPreview.value
}

watch(
  () => [props.selectedNode?.id, props.selectedNode?.note?.text],
  () => {
    draft.value = props.selectedNode?.note?.text ?? ''
  },
  { immediate: true }
)

watch(
  () => props.focusTick,
  async () => {
    if (props.readonly) return
    await nextTick()
    const ta = document.querySelector<HTMLTextAreaElement>('.zm-note-panel textarea.zm-note-textarea')
    if (ta) {
      ta.focus()
      const len = ta.value.length
      ta.setSelectionRange(len, len)
    }
  }
)

function commitNote() {
  if (props.readonly) return
  const next = draft.value
  const current = props.selectedNode?.note?.text ?? ''
  if (next === current) return
  emit('apply', next)
}
function onNoteKeydown(e: KeyboardEvent) {
  if (props.readonly) return
  if (e.key === 'Escape') {
    e.preventDefault()
    draft.value = props.selectedNode?.note?.text ?? ''
    ;(e.target as HTMLTextAreaElement).blur()
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    commitNote()
    ;(e.target as HTMLTextAreaElement).blur()
  }
}
function onRemoveNote() {
  if (props.readonly) return
  if (!confirm('移除该节点的笔记?')) return
  draft.value = ''
  emit('remove')
}

// ---------------------------------------------------------------------------
// Section visibility flags
// ---------------------------------------------------------------------------
const hasLink = computed(() => !!props.selectedNode?.link?.url)
const hasImage = computed(() => !!props.selectedNode?.image?.src)
const richKind = computed(() => props.selectedNode?.richContent?.kind)
const hasCode = computed(() => richKind.value === 'code')
const hasTable = computed(() => richKind.value === 'table')

// Per-section "expanded" toggles.  Optional sections (link / image
// / code / table) hide their input by default; the user clicks the
// "add" chip to reveal it.  Reset whenever a different node is
// selected.
const showLink = ref(false)
const showImage = ref(false)
const showCode = ref(false)
const showTable = ref(false)
watch(
  () => props.selectedNode?.id,
  () => {
    showLink.value = false
    showImage.value = false
    showCode.value = false
    showTable.value = false
  }
)

// ---------------------------------------------------------------------------
// Link edit
// ---------------------------------------------------------------------------
const linkDraft = ref('')
watch(
  () => [props.selectedNode?.id, props.selectedNode?.link?.url],
  () => {
    linkDraft.value = props.selectedNode?.link?.url ?? ''
  },
  { immediate: true }
)
function commitLink() {
  if (props.readonly) return
  const next = linkDraft.value.trim()
  const current = props.selectedNode?.link?.url ?? ''
  if (next === current) return
  emit('set-link', next)
}

// ---------------------------------------------------------------------------
// Image edit
// ---------------------------------------------------------------------------
const imageDraft = ref('')
watch(
  () => [props.selectedNode?.id, props.selectedNode?.image?.src],
  () => {
    imageDraft.value = props.selectedNode?.image?.src ?? ''
  },
  { immediate: true }
)
function commitImage() {
  if (props.readonly) return
  const next = imageDraft.value.trim()
  const current = props.selectedNode?.image?.src ?? ''
  if (next === current) return
  emit('set-image', next)
}
function onImageError(e: Event) {
  const img = e.target as HTMLImageElement
  img.style.display = 'none'
}
function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement
  img.style.display = ''
}

// ---------------------------------------------------------------------------
// Code edit — textarea holds the raw markdown (with or without
// the ``` fence), preview re-highlights as the user types.  On
// commit we re-derive the lang tag from the opening fence and
// emit a new richContent payload.
// ---------------------------------------------------------------------------
const codeDraft = ref('')
const codeRef = ref<HTMLTextAreaElement | null>(null)
useAutosize(codeRef, { minRows: 4, maxRows: 18 })
watch(
  () => [props.selectedNode?.id, props.selectedNode?.richContent?.raw],
  () => {
    codeDraft.value = props.selectedNode?.richContent?.raw ?? ''
  },
  { immediate: true }
)
const codePreviewHtml = computed(() => {
  return highlightCode(stripCodeFence(codeDraft.value), codeLang(codeDraft.value))
})
function commitCode() {
  if (props.readonly) return
  const next = codeDraft.value
  const current = props.selectedNode?.richContent?.raw ?? ''
  if (next === current) return
  const lang = codeLang(next) || undefined
  emit('set-rich', next ? { kind: 'code', raw: next, lang } : null)
}

// ---------------------------------------------------------------------------
// Table edit — textarea holds the raw markdown; preview is
// sortable but only in-memory (raw stays untouched).
// ---------------------------------------------------------------------------
const tableDraft = ref('')
const tableRef = ref<HTMLTextAreaElement | null>(null)
useAutosize(tableRef, { minRows: 4, maxRows: 14 })
const sortCol = ref(-1)
const sortDir = ref<SortDir>('asc')
watch(
  () => [props.selectedNode?.id, props.selectedNode?.richContent?.raw],
  () => {
    tableDraft.value = props.selectedNode?.richContent?.raw ?? ''
    // Switching nodes resets the sort UI.
    sortCol.value = -1
    sortDir.value = 'asc'
  },
  { immediate: true }
)
function commitTable() {
  if (props.readonly) return
  const next = tableDraft.value
  const current = props.selectedNode?.richContent?.raw ?? ''
  if (next === current) return
  emit('set-rich', next ? { kind: 'table', raw: next } : null)
}

// Live parse for the table preview.  Uses textarea content so the
// preview reflects in-progress edits before commit.
const tableParsedRows = computed(() => tableRows(tableDraft.value))
const sortedRows = computed(() => {
  const rows = tableParsedRows.value
  if (sortCol.value < 0 || rows.length <= 1) return rows
  return sortTable(rows, sortCol.value, sortDir.value)
})
function toggleSort(col: number) {
  if (sortCol.value !== col) {
    sortCol.value = col
    sortDir.value = 'asc'
  } else if (sortDir.value === 'asc') {
    sortDir.value = 'desc'
  } else {
    sortCol.value = -1
  }
}

// ---------------------------------------------------------------------------
// Header summary
// ---------------------------------------------------------------------------
const summary = computed(() => {
  const parts: string[] = []
  if (!isEmpty.value) parts.push(`${draft.value.length} 字`)
  if (hasLink.value) parts.push('1 链接')
  if (hasImage.value) parts.push('1 图片')
  if (hasCode.value) parts.push('代码块')
  if (hasTable.value) parts.push('表格')
  if (parts.length === 0) return '节点没有额外内容'
  return parts.join(' · ')
})
</script>

<template>
  <div class="zm-note-panel">
    <div v-if="!selectedNode" class="zm-note-empty">
      <p>请先在画布上选中一个节点。</p>
      <p class="zm-note-hint">
        选中节点后，会在这里展示并可编辑节点的笔记、链接、图片、代码块、表格。
      </p>
    </div>
    <template v-else>
      <div class="zm-note-header">
        <div class="zm-note-title-row">
          <span class="zm-note-label">节点</span>
          <span class="zm-note-name">{{ selectedNode.text || '(无标题)' }}</span>
        </div>
        <div class="zm-note-meta">{{ summary }}</div>
      </div>

      <div class="zm-note-scroll">
        <!-- Note -->
        <section class="zm-note-section">
          <header class="zm-note-section-head">
            <span class="zm-note-section-title">笔记</span>
            <span class="zm-note-section-hint">Ctrl+Enter 提交, Esc 取消</span>
            <button
              v-if="!readonly"
              type="button"
              class="zm-note-preview-toggle"
              @click="togglePreview"
            >{{ showPreview ? '隐藏预览' : '显示预览' }}</button>
          </header>
          <div class="zm-note-split">
            <textarea
              ref="noteRef"
              v-model="draft"
              class="zm-note-textarea"
              :placeholder="'写点什么吧… 支持 Markdown'"
              spellcheck="false"
              :disabled="readonly"
              @blur="commitNote"
              @keydown="onNoteKeydown"
            />
            <div v-if="showPreview" class="zm-note-preview">
              <div
                v-if="!isEmpty"
                class="zm-note-preview-body"
                v-html="noteHtml"
              ></div>
              <div v-else class="zm-note-preview-hint">
                渲染后的 Markdown 仅在此面板显示,不会撑大节点框。
              </div>
            </div>
          </div>
          <div v-if="!readonly && !isEmpty" class="zm-note-section-actions">
            <button class="zm-note-action-btn is-danger" @click="onRemoveNote">移除笔记</button>
          </div>
        </section>

        <!-- Add-row: chips for sections that are not yet populated. -->
        <div v-if="!readonly" class="zm-note-add-row">
          <button
            v-if="!hasLink && !showLink"
            class="zm-note-add-chip"
            @click="showLink = true"
          >+ 链接</button>
          <button
            v-if="!hasImage && !showImage"
            class="zm-note-add-chip"
            @click="showImage = true"
          >+ 图片</button>
          <button
            v-if="!hasCode && !showCode"
            class="zm-note-add-chip"
            @click="showCode = true"
          >+ 代码块</button>
          <button
            v-if="!hasTable && !showTable"
            class="zm-note-add-chip"
            @click="showTable = true"
          >+ 表格</button>
        </div>

        <!-- Link -->
        <section v-if="hasLink || showLink" class="zm-note-section">
          <header class="zm-note-section-head">
            <span class="zm-note-section-title">链接</span>
          </header>
          <input
            v-model="linkDraft"
            class="zm-note-input"
            type="url"
            :placeholder="'https://…'"
            :disabled="readonly"
            @blur="commitLink"
            @keydown.enter.prevent="(e) => (e.target as HTMLInputElement).blur()"
          />
          <a
            v-if="hasLink"
            class="zm-note-link-chip"
            :href="selectedNode.link?.url"
            target="_blank"
            rel="noopener noreferrer"
            :title="selectedNode.link?.url"
          >{{ selectedNode.link?.url }}</a>
        </section>

        <!-- Image -->
        <section v-if="hasImage || showImage" class="zm-note-section">
          <header class="zm-note-section-head">
            <span class="zm-note-section-title">图片</span>
          </header>
          <input
            v-model="imageDraft"
            class="zm-note-input"
            type="url"
            :placeholder="'data:image/… 或 https://…'"
            :disabled="readonly"
            @blur="commitImage"
            @keydown.enter.prevent="(e) => (e.target as HTMLInputElement).blur()"
          />
          <img
            v-if="hasImage"
            class="zm-note-image"
            :src="selectedNode.image?.src"
            :alt="selectedNode.text"
            @error="onImageError"
            @load="onImageLoad"
          />
        </section>

        <!-- Code -->
        <section v-if="hasCode || showCode" class="zm-note-section">
          <header class="zm-note-section-head">
            <span class="zm-note-section-title">代码块</span>
            <span v-if="codeLang(codeDraft)" class="zm-note-section-tag">{{ codeLang(codeDraft) }}</span>
          </header>
          <textarea
            ref="codeRef"
            v-model="codeDraft"
            class="zm-note-input zm-note-input-code"
            :placeholder="'```ts\nconsole.log(123)\n```'"
            spellcheck="false"
            :disabled="readonly"
            @blur="commitCode"
          />
          <pre v-if="codeDraft.trim()" class="zm-note-code"><code v-html="codePreviewHtml"></code></pre>
        </section>

        <!-- Table -->
        <section v-if="hasTable || showTable" class="zm-note-section">
          <header class="zm-note-section-head">
            <span class="zm-note-section-title">表格</span>
            <span class="zm-note-section-hint">点击表头排序</span>
          </header>
          <textarea
            ref="tableRef"
            v-model="tableDraft"
            class="zm-note-input zm-note-input-code"
            :placeholder="'| 列1 | 列2 |\n| --- | --- |\n| a | b |'"
            spellcheck="false"
            :disabled="readonly"
            @blur="commitTable"
          />
          <table v-if="tableParsedRows.length" class="zm-note-table">
            <tbody>
              <tr v-for="(row, ri) in sortedRows" :key="ri">
                <th
                  v-if="ri === 0"
                  v-for="(cell, ci) in row"
                  :key="`h${ci}`"
                  class="zm-note-table-sort"
                  :class="{
                    'is-sorted': sortCol === ci,
                    'is-asc': sortCol === ci && sortDir === 'asc',
                    'is-desc': sortCol === ci && sortDir === 'desc',
                  }"
                  @click="toggleSort(ci)"
                >
                  <span>{{ cell }}</span>
                  <span class="zm-note-table-sort-mark" aria-hidden="true">
                    {{ sortCol === ci ? (sortDir === 'asc' ? '▲' : '▼') : '↕' }}
                  </span>
                </th>
                <td
                  v-else
                  v-for="(cell, ci) in row"
                  :key="`c${ci}`"
                >{{ cell }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </template>
  </div>
</template>

<style>
@import 'highlight.js/styles/github.css';

.zm-note-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px 12px 16px;
  gap: 10px;
  background: #f8fafc;
}
.zm-note-empty {
  padding: 20px 12px;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}
.zm-note-empty p {
  margin: 0 0 6px;
}
.zm-note-hint {
  color: #94a3b8;
  font-size: 12px;
}
.zm-note-header {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}
.zm-note-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.zm-note-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
  flex-shrink: 0;
}
.zm-note-name {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.zm-note-meta {
  font-size: 11px;
  color: #94a3b8;
}
.zm-note-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
}
.zm-note-section {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.zm-note-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.zm-note-section-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
  flex: 1;
  min-width: 0;
}
.zm-note-section-hint {
  font-size: 10px;
  color: #94a3b8;
}
.zm-note-section-tag {
  font-size: 10px;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  color: #475569;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 1px 6px;
  line-height: 1.4;
}
.zm-note-section-actions {
  display: flex;
  justify-content: flex-end;
}

.zm-note-textarea {
  width: 100%;
  /* Height is set by the autosize composable; keep a sane
     default for the first paint before mount. */
  min-height: 120px;
  padding: 10px 12px;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  color: #1e293b;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  resize: none;
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
  overflow: hidden;
}
.zm-note-textarea:focus {
  border-color: #3b82f6;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}
.zm-note-textarea:disabled {
  background: #f8fafc;
  color: #94a3b8;
  cursor: not-allowed;
}
.zm-note-textarea::placeholder {
  color: #94a3b8;
  white-space: pre-line;
}

.zm-note-split {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.zm-note-preview-toggle {
  font: inherit;
  font-size: 10px;
  color: #1d4ed8;
  background: transparent;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  padding: 1px 8px;
  cursor: pointer;
  transition: all 0.1s;
  flex-shrink: 0;
}
.zm-note-preview-toggle:hover {
  background: #eff6ff;
  border-color: #93c5fd;
}
.zm-note-preview {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 8px 12px;
  max-height: 240px;
  overflow: auto;
  font-size: 13px;
  line-height: 1.6;
  color: #1e293b;
}
.zm-note-preview-hint {
  color: #94a3b8;
  font-size: 12px;
  font-style: italic;
}
.zm-note-preview-body h1,
.zm-note-preview-body h2,
.zm-note-preview-body h3 {
  margin: 8px 0 4px;
  font-weight: 600;
  color: #0f172a;
}
.zm-note-preview-body h1 { font-size: 16px; }
.zm-note-preview-body h2 { font-size: 14px; }
.zm-note-preview-body h3 { font-size: 13px; }
.zm-note-preview-body h4,
.zm-note-preview-body h5,
.zm-note-preview-body h6 {
  margin: 6px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: #334155;
}
.zm-note-preview-body p { margin: 0 0 6px; }
.zm-note-preview-body p:last-child { margin-bottom: 0; }
.zm-note-preview-body ul,
.zm-note-preview-body ol {
  margin: 0 0 6px;
  padding-left: 20px;
}
.zm-note-preview-body li { margin: 0 0 2px; }
.zm-note-preview-body blockquote {
  margin: 0 0 6px;
  padding: 4px 10px;
  border-left: 3px solid #cbd5e1;
  color: #475569;
  background: #f1f5f9;
}
.zm-note-preview-body code {
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  font-size: 12px;
  background: #f1f5f9;
  padding: 1px 4px;
  border-radius: 3px;
  color: #be185d;
}
.zm-note-preview-body pre {
  margin: 0 0 6px;
  padding: 8px 10px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  overflow: auto;
}
.zm-note-preview-body pre code {
  background: transparent;
  padding: 0;
  color: inherit;
  font-size: 12px;
  line-height: 1.55;
}
.zm-note-preview-body a {
  color: #1d4ed8;
  text-decoration: underline;
  text-decoration-color: #bfdbfe;
}
.zm-note-preview-body a:hover {
  text-decoration-color: #1d4ed8;
}
.zm-note-preview-body table {
  border-collapse: collapse;
  margin: 0 0 6px;
  font-size: 12px;
}
.zm-note-preview-body th,
.zm-note-preview-body td {
  border: 1px solid #e2e8f0;
  padding: 4px 8px;
  text-align: left;
}
.zm-note-preview-body th {
  background: #f1f5f9;
  font-weight: 600;
}
.zm-note-preview-body hr {
  border: none;
  border-top: 1px solid #e2e8f0;
  margin: 8px 0;
}
.zm-note-preview-body img {
  max-width: 100%;
  max-height: 200px;
  border-radius: 4px;
  display: block;
}

.zm-note-input {
  width: 100%;
  padding: 7px 10px;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  color: #1e293b;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
}
.zm-note-input:focus {
  border-color: #3b82f6;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}
.zm-note-input:disabled {
  background: #f8fafc;
  color: #94a3b8;
  cursor: not-allowed;
}
.zm-note-input-code {
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  font-size: 11px;
  /* min-height + resize are now driven by the autosize composable;
     keep a sane default for the first paint before mount. */
  min-height: 80px;
  resize: none;
  white-space: pre;
  line-height: 20px;
  overflow: hidden;
}

.zm-note-add-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 2px 2px 0;
}
.zm-note-add-chip {
  font: inherit;
  font-size: 11px;
  color: #64748b;
  background: #ffffff;
  border: 1px dashed #cbd5e1;
  border-radius: 999px;
  padding: 3px 10px;
  cursor: pointer;
  transition: all 0.1s;
}
.zm-note-add-chip:hover {
  color: #1d4ed8;
  border-color: #93c5fd;
  background: #eff6ff;
}

.zm-note-link-chip {
  display: inline-block;
  max-width: 100%;
  padding: 6px 10px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  color: #1d4ed8;
  font-size: 12px;
  text-decoration: none;
  word-break: break-all;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.1s;
}
.zm-note-link-chip:hover {
  background: #dbeafe;
}

.zm-note-image {
  display: block;
  max-width: 100%;
  max-height: 240px;
  object-fit: contain;
  border-radius: 6px;
  background: #f1f5f9;
  margin: 0 auto;
}

.zm-note-code {
  margin: 0;
  padding: 10px 12px;
  background: #f1f5f9;
  color: #24292e;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow: auto;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}
.zm-note-code code {
  font: inherit;
  color: inherit;
  background: transparent;
  padding: 0;
}

.zm-note-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
  color: #1e293b;
  table-layout: auto;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(146, 64, 14, 0.08);
}
.zm-note-table td {
  border-top: 1px solid #fde68a;
  border-right: 1px solid #fde68a;
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
  word-break: break-word;
  background: #fffbeb;
}
.zm-note-table tr:last-child td {
  border-bottom: none;
}
.zm-note-table td:last-child {
  border-right: none;
}
.zm-note-table-sort {
  background: #fef3c7;
  font-weight: 600;
  padding: 6px 10px;
  border-bottom: 1px solid #fcd34d;
  border-right: 1px solid #fde68a;
  text-align: left;
  cursor: pointer;
  user-select: none;
  position: relative;
}
.zm-note-table-sort:last-child {
  border-right: none;
}
.zm-note-table-sort:hover {
  background: #fde68a;
}
.zm-note-table-sort.is-sorted {
  background: #fde68a;
  color: #92400e;
}
.zm-note-table-sort-mark {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  color: #94a3b8;
}
.zm-note-table-sort.is-sorted .zm-note-table-sort-mark {
  color: #1d4ed8;
}

.zm-note-action-btn {
  padding: 4px 10px;
  font-size: 12px;
  font-family: inherit;
  color: #ffffff;
  background: #3b82f6;
  border: 1px solid #3b82f6;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.1s;
}
.zm-note-action-btn.is-danger {
  color: #b91c1c;
  background: #ffffff;
  border-color: #fca5a5;
}
.zm-note-action-btn.is-danger:hover {
  background: #fee2e2;
  border-color: #f87171;
}
</style>
