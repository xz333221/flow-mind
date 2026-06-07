<script setup lang="ts">
/**
 * Note panel — body of the right-side "笔记" drawer.  When a node
 * is selected on the canvas, the parent (App.vue) opens this
 * drawer, mounts a NotePanel scoped to that node, and forwards
 * the user's edits to MindMap.applyNodeNote / removeNodeNote.
 *
 * The drawer is intentionally always pinned to whatever node the
 * user last selected; clicking a different node on the canvas
 * swaps the bound `data` prop, the local draft re-seeds from
 * the new node's note, and (if the drawer was open) the parent
 * keeps it open.  This mirrors how the Outline panel binds to
 * the same data tree.
 */
import { computed, ref, watch, nextTick } from 'vue'
import type { MindMapNode } from '../types'

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
  /** User edited the note.  `text` may be empty (clears the note). */
  (e: 'apply', text: string): void
  /** User removed the note entirely. */
  (e: 'remove'): void
}>()

const draft = ref('')
const isEmpty = computed(() => !draft.value || draft.value.trim() === '')

// Keep the draft in sync with the bound node.  Whenever the
// selected id changes (or the underlying note field changes via
// undo/redo), the draft re-seeds.
watch(
  () => [props.selectedNode?.id, props.selectedNode?.note?.text],
  () => {
    draft.value = props.selectedNode?.note?.text ?? ''
  },
  { immediate: true }
)

// Focus the textarea when the parent signals a fresh open.  We
// use a `tick` prop rather than auto-focusing on mount so that
// re-selecting a node while the drawer is already open also
// re-focuses.
watch(
  () => props.focusTick,
  async () => {
    if (props.readonly) return
    await nextTick()
    const ta = document.querySelector<HTMLTextAreaElement>('.zm-note-panel textarea')
    if (ta) {
      ta.focus()
      // Don't select all on re-focus — the user might just want
      // the cursor at the end.  Place caret at the end of the
      // current text instead.
      const len = ta.value.length
      ta.setSelectionRange(len, len)
    }
  }
)

function commit() {
  if (props.readonly) return
  const next = draft.value
  const current = props.selectedNode?.note?.text ?? ''
  if (next === current) return
  emit('apply', next)
}

function onKeydown(e: KeyboardEvent) {
  if (props.readonly) return
  if (e.key === 'Escape') {
    e.preventDefault()
    // Revert local draft and lose focus.  Parent keeps the
    // drawer open so the user can re-open the editor.
    draft.value = props.selectedNode?.note?.text ?? ''
    ;(e.target as HTMLTextAreaElement).blur()
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    commit()
    ;(e.target as HTMLTextAreaElement).blur()
  }
}

function onRemove() {
  if (props.readonly) return
  if (!confirm('移除该节点的笔记?')) return
  draft.value = ''
  emit('remove')
}
</script>

<template>
  <div class="zm-note-panel">
    <div v-if="!selectedNode" class="zm-note-empty">
      <p>请先在画布上选中一个节点。</p>
      <p class="zm-note-hint">
        选中节点后，会在这里展示并允许编辑节点的笔记。
      </p>
    </div>
    <template v-else>
      <div class="zm-note-header">
        <div class="zm-note-title-row">
          <span class="zm-note-label">节点</span>
          <span class="zm-note-name">{{ selectedNode.text || '(无标题)' }}</span>
        </div>
        <div class="zm-note-meta">
          {{ isEmpty ? '没有笔记' : `共 ${draft.length} 字` }}
        </div>
      </div>
      <textarea
        v-model="draft"
        class="zm-note-textarea"
        :placeholder="'写点什么吧…\n(Ctrl+Enter 提交, Esc 取消, blur 自动提交)'"
        spellcheck="false"
        :disabled="readonly"
        @blur="commit"
        @keydown="onKeydown"
      />
      <div class="zm-note-actions">
        <button
          v-if="!readonly && !isEmpty"
          class="zm-note-action-btn is-danger"
          title="移除笔记"
          @click="onRemove"
        >移除笔记</button>
        <span class="zm-note-spacer" />
        <span class="zm-note-hint-inline">支持多行文本</span>
      </div>
    </template>
  </div>
</template>

<style>
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
.zm-note-textarea {
  flex: 1;
  min-height: 200px;
  width: 100%;
  padding: 10px 12px;
  font: inherit;
  font-size: 13px;
  line-height: 1.6;
  color: #1e293b;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  resize: none;
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
}
.zm-note-textarea:focus {
  border-color: #3b82f6;
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
.zm-note-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.zm-note-spacer {
  flex: 1;
}
.zm-note-hint-inline {
  font-size: 11px;
  color: #94a3b8;
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
