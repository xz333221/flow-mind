<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, reactive } from 'vue'
import MindMap from './components/MindMap.vue'
import Drawer from './components/Drawer.vue'
import Outline from './components/Outline.vue'
import DataPanel from './components/DataPanel.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import type { MindMapNode, MindMapSettings } from './types'

// Sample data — same shape the user can pass in production.
const initialData: MindMapNode = {
  id: 'root',
  text: 'z-mind 思维导图',
  children: [
    {
      id: 'n_features',
      text: '核心功能',
      children: [
        { id: 'n_f1', text: '节点增删改', children: [] },
        { id: 'n_f2', text: '拖拽布局', children: [] },
        { id: 'n_f3', text: '缩放与平移', children: [] },
        { id: 'n_f4', text: '键盘快捷键', children: [] },
      ],
    },
    {
      id: 'n_tech',
      text: '技术栈',
      children: [
        { id: 'n_t1', text: 'Vue 3 + Vite', children: [] },
        { id: 'n_t2', text: 'TypeScript', children: [] },
        { id: 'n_t3', text: '纯 SVG 渲染', children: [] },
      ],
    },
    {
      id: 'n_open',
      text: '开源',
      children: [
        { id: 'n_o1', text: 'MIT 协议', children: [] },
        { id: 'n_o2', text: '可作为 npm 组件使用', children: [] },
      ],
    },
  ],
}

const data = ref<MindMapNode>(initialData)
const selectedNode = ref<MindMapNode | null>(null)
const collapsedIds = ref<Set<string>>(new Set())
const showOutline = ref(false)
const showData = ref(false)
const showSettings = ref(false)
const mindMapRef = ref<InstanceType<typeof MindMap> | null>(null)

// Local mirror of the MindMap settings; we apply changes by calling
// applySettings on the component.  The initial state matches the
// MindMap's own defaults so the UI is consistent.
const settings = reactive<MindMapSettings>({
  autoBalanceOnChange: false,
  lineWidthStart: 2.2,
  lineWidthEnd: 0.8,
  rainbowBranch: false,
})

function onSettingsChange(s: Partial<MindMapSettings>) {
  Object.assign(settings, s)
  mindMapRef.value?.applySettings(s)
}

function onNodeStyleChange(style: { bg?: string; textColor?: string; borderColor?: string; fontWeight?: 400 | 600 }) {
  if (!selectedNode.value) return
  mindMapRef.value?.applyNodeStyle(selectedNode.value.id, style)
}

function resetSettings() {
  const defaults: MindMapSettings = {
    autoBalanceOnChange: false,
    lineWidthStart: 2.2,
    lineWidthEnd: 0.8,
    rainbowBranch: false,
  }
  Object.assign(settings, defaults)
  mindMapRef.value?.applySettings(defaults)
}

// Close the settings popover on outside click or Escape.
function onDocClick(e: MouseEvent) {
  if (!showSettings.value) return
  const target = e.target as HTMLElement | null
  // clicks inside the popover or on its toggle button don't close
  if (target && target.closest('.zm-settings-popover')) return
  if (target && target.closest('.zm-app-icon-btn[title="显示设置"]')) return
  showSettings.value = false
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && showSettings.value) {
    showSettings.value = false
    e.stopPropagation()
  }
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKeydown)
})

function onChange(next: MindMapNode) {
  data.value = next
}

function onSelect(node: MindMapNode | null) {
  selectedNode.value = node
}

function onOutlineSelect(node: MindMapNode) {
  // tell the main canvas to select this node.  We use the imperative
  // setData + resetView combo as a "scroll to" signal: the simplest way
  // to surface the click is to flash the selected node — the MindMap
  // already emits 'select' on its own node clicks.  Here we just need
  // a way to *send* a selection into the canvas.  In the current API
  // the canvas manages selection internally on click; for the outline
  // we can scroll the node into view via the canvas's resetView().
  mindMapRef.value?.resetView()
  // also drive the `select` event by clicking the node programmatically
  const el = document.querySelector(`[data-node-id="${node.id}"]`) as HTMLElement | null
  if (el) el.click()
}

function toggleCollapse(id: string) {
  const next = new Set(collapsedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsedIds.value = next
  // re-trigger layout by bumping a dummy ref / using setData(no-op)
  // The MindMap accepts `defaultCollapsedIds` as a one-time init; for
  // a controlled-state model we'd need a prop + event.  For now the
  // outline reflects the parent's collapsedIds, while the main canvas
  // keeps its own internal collapse state.
}

// highlight on the main canvas: watch selectedNode and find the matching
// element to add a brief "flash" class.  For now we just keep the
// reference in state.
const selectedId = computed(() => selectedNode.value?.id ?? null)

function countNodes(n: MindMapNode): number {
  return 1 + n.children.reduce((acc, c) => acc + countNodes(c), 0)
}
const totalNodes = computed(() => countNodes(data.value))
</script>

<template>
  <div class="zm-app">
    <Drawer
      side="left"
      :width="300"
      :open="showOutline"
      title="大纲"
      @update:open="(v) => (showOutline = v)"
    >
      <Outline
        :data="data"
        :selected-id="selectedId"
        :collapsed-ids="collapsedIds"
        @select="onOutlineSelect"
        @toggle-collapse="toggleCollapse"
      />
    </Drawer>

    <main class="zm-app-main">
      <div class="zm-app-toolbar">        <button
          v-if="!showOutline"
          class="zm-app-icon-btn"
          title="显示大纲"
          @click="showOutline = true"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </button>
        <button
          v-if="!showData"
          class="zm-app-icon-btn"
          title="显示数据"
          @click="showData = true"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </button>
        <button
          v-if="!showSettings"
          class="zm-app-icon-btn"
          title="显示设置"
          @click="showSettings = true"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <span class="zm-app-spacer" />
        <span class="zm-app-tip">{{ data.text || '未命名' }} · {{ totalNodes }} 节点</span>
      </div>
      <div class="zm-app-canvas">
        <MindMap
          ref="mindMapRef"
          :data="data"
          @change="onChange"
          @select="onSelect"
        />
      </div>
    </main>

    <Drawer
      side="right"
      :width="360"
      :open="showData"
      title="数据"
      @update:open="(v) => (showData = v)"
    >
      <DataPanel
        :data="data"
        @import="(d) => (data = d)"
      />
    </Drawer>

    <!-- Settings: floating popover anchored at the toolbar, toggled by
         the gear button.  Sits above the canvas so it doesn't compete
         with the persistent side drawers. -->
    <div v-if="showSettings" class="zm-settings-backdrop" @click="showSettings = false" />
    <div v-if="showSettings" class="zm-settings-popover" @click.stop>
      <div class="zm-settings-popover-header">
        <span class="zm-settings-popover-title">设置</span>
        <button class="zm-settings-close" @click="showSettings = false" title="关闭">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M6 6 L18 18 M18 6 L6 18" />
          </svg>
        </button>
      </div>
      <SettingsPanel
        :settings="settings"
        :has-selection="selectedNode !== null"
        :selected-node-text="selectedNode?.text"
        @update:settings="onSettingsChange"
        @update:node-style="onNodeStyleChange"
        @reset="resetSettings"
      />
    </div>
  </div>
</template>


<style>
.zm-app {
  display: flex;
  width: 100%;
  height: 100%;
  background: #f8fafc;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  color: #1e293b;
  overflow: hidden;
}
.zm-app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.zm-app-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.zm-app-icon-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  border-radius: 6px;
  cursor: pointer;
  color: #475569;
}
.zm-app-icon-btn:hover {
  background: #f1f5f9;
  color: #1e293b;
}
.zm-app-spacer {
  flex: 1;
}
.zm-app-tip {
  font-size: 12px;
  color: #64748b;
}
.zm-app-canvas {
  flex: 1;
  position: relative;
  min-height: 0;
}

/* Settings popover — modal-style: a dimmed backdrop covers the
   canvas, the popover floats in the top-right corner.  Clicking the
   backdrop closes the popover. */
.zm-settings-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.15);
  z-index: 49;
  /* visual dim only — let clicks pass through to the canvas */
  pointer-events: none;
}
.zm-settings-popover {
  position: absolute;
  top: 50px;
  right: 16px;
  width: 320px;
  max-height: calc(100% - 64px);
  z-index: 50;
  display: flex;
  flex-direction: column;
}
.zm-settings-popover > * {
  pointer-events: auto;
}
.zm-settings-popover .zm-settings-popover-header,
.zm-settings-popover .zm-settings-panel {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.12);
  overflow: auto;
}
.zm-settings-popover .zm-settings-popover-header {
  display: flex;
  align-items: center;
  padding: 8px 10px 8px 14px;
  border-bottom: 1px solid #f1f5f9;
  flex-shrink: 0;
}
.zm-settings-popover-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  letter-spacing: 0.02em;
}
.zm-settings-close {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #94a3b8;
  border-radius: 4px;
  cursor: pointer;
}
.zm-settings-close:hover {
  background: #f1f5f9;
  color: #1e293b;
}
</style>
