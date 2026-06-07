<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{
    /** Cursor X in viewport coords (clientX). */
    x: number
    /** Cursor Y in viewport coords (clientY). */
    y: number
    /** Container the menu should not escape — used to clamp the
     *  position so the menu stays on-screen. */
    container: HTMLElement | null
    /** Whether the node already has an image.  When true, the
     *  "添加图片" action is renamed "替换图片" and a "移除图片"
     *  action is appended. */
    hasImage?: boolean
    /** Whether the node already has a link.  Drives the label /
     *  presence of the "添加链接" / "编辑链接" / "移除链接"
     *  actions. */
    hasLink?: boolean
    /** Whether the node already has a note.  Same role as
     *  hasLink for the note action. */
    hasNote?: boolean
    /** True if the component is in readonly mode — all actions
     *  render but are disabled. */
    readonly?: boolean
  }>(),
  { hasImage: false, hasLink: false, hasNote: false, readonly: false }
)

const emit = defineEmits<{
  (e: 'pickImage'): void
  (e: 'setLink'): void
  (e: 'removeLink'): void
  (e: 'editNote'): void
  (e: 'removeNote'): void
  (e: 'removeImage'): void
  (e: 'close'): void
}>()

interface ClampedPos { left: number; top: number }
const clamped = computed<ClampedPos>(() => {
  // Default: place top-left at the cursor with a small offset so
  // the cursor isn't right on the first item.
  let left = props.x + 2
  let top = props.y + 2
  // Clamp to the container if provided — keeps the menu inside
  // the canvas instead of spilling off-screen.
  if (props.container) {
    const rect = props.container.getBoundingClientRect()
    const menuWidth = 180
    const menuHeight = hasImage.value
      ? hasLink.value
        ? 184
        : 160
      : 136
    if (left + menuWidth > rect.right) {
      left = Math.max(rect.left + 4, props.x - menuWidth - 2)
    }
    if (top + menuHeight > rect.bottom) {
      top = Math.max(rect.top + 4, props.y - menuHeight - 2)
    }
    if (left < rect.left + 2) left = rect.left + 2
    if (top < rect.top + 2) top = rect.top + 2
  }
  return { left, top }
})

const hasImage = computed(() => props.hasImage)
const hasLink = computed(() => props.hasLink)
const hasNote = computed(() => props.hasNote)

// Wire window-level listeners to close the menu on outside click /
// Esc / scroll.  Caller invokes `emit('close')` to dismiss; the
// parent flips `showMenu` to false and unmounts us.
function onWindowMouseDown(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (target && target.closest('.zm-node-menu')) return
  emit('close')
}
function onWindowKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
function onWindowScroll() {
  emit('close')
}
window.addEventListener('mousedown', onWindowMouseDown, true)
window.addEventListener('keydown', onWindowKey, true)
window.addEventListener('wheel', onWindowScroll, true)
window.addEventListener('scroll', onWindowScroll, true)
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onWindowMouseDown, true)
  window.removeEventListener('keydown', onWindowKey, true)
  window.removeEventListener('wheel', onWindowScroll, true)
  window.removeEventListener('scroll', onWindowScroll, true)
})

function run(handler: () => void) {
  if (props.readonly) return
  handler()
  emit('close')
}
</script>

<template>
  <div
    class="zm-node-menu"
    :style="{ left: clamped.left + 'px', top: clamped.top + 'px' }"
    @contextmenu.prevent
  >
    <button class="zm-node-menu-item" :disabled="readonly" @click.stop="run(() => emit('pickImage'))">
      <Icon name="image" :size="13" />
      <span>{{ hasImage ? '替换图片' : '添加图片' }}</span>
    </button>
    <button v-if="hasImage" class="zm-node-menu-item" :disabled="readonly" @click.stop="run(() => emit('removeImage'))">
      <Icon name="x" :size="13" />
      <span>移除图片</span>
    </button>
    <button class="zm-node-menu-item" :disabled="readonly" @click.stop="run(() => emit('setLink'))">
      <Icon name="link" :size="13" />
      <span>{{ hasLink ? '编辑链接' : '添加链接' }}</span>
    </button>
    <button v-if="hasLink" class="zm-node-menu-item" :disabled="readonly" @click.stop="run(() => emit('removeLink'))">
      <Icon name="x" :size="13" />
      <span>移除链接</span>
    </button>
    <button class="zm-node-menu-item" :disabled="readonly" @click.stop="run(() => emit('editNote'))">
      <Icon name="note" :size="13" />
      <span>{{ hasNote ? '编辑笔记' : '添加笔记' }}</span>
    </button>
    <button v-if="hasNote" class="zm-node-menu-item" :disabled="readonly" @click.stop="run(() => emit('removeNote'))">
      <Icon name="x" :size="13" />
      <span>移除笔记</span>
    </button>
  </div>
</template>

<style>
.zm-node-menu {
  position: fixed;
  z-index: 40;
  min-width: 168px;
  padding: 4px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  color: #1e293b;
  user-select: none;
}
.zm-node-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  border-radius: 4px;
  cursor: pointer;
  width: 100%;
  transition: background 0.1s;
}
.zm-node-menu-item:hover:not(:disabled) {
  background: #f1f5f9;
}
.zm-node-menu-item:active:not(:disabled) {
  background: #e2e8f0;
}
.zm-node-menu-item:disabled {
  color: #94a3b8;
  cursor: not-allowed;
}
</style>
