<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, reactive } from 'vue'
import MindMap from './components/MindMap.vue'
import Drawer from './components/Drawer.vue'
import Outline from './components/Outline.vue'
import DataPanel from './components/DataPanel.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import MarkdownPanel from './components/MarkdownPanel.vue'
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
        { id: 'n_f5', text: '导入导出 JSON', children: [] },
        { id: 'n_f6', text: '撤销与重做', children: [] },
      ],
    },
    {
      id: 'n_tech',
      text: '技术栈',
      children: [
        { id: 'n_t1', text: 'Vue 3 + Vite', children: [] },
        { id: 'n_t2', text: 'TypeScript', children: [] },
        { id: 'n_t3', text: '纯 SVG 渲染', children: [] },
        { id: 'n_t4', text: '无第三方依赖', children: [] },
      ],
    },
    {
      id: 'n_open',
      text: '开源',
      children: [
        { id: 'n_o1', text: 'Apache-2.0 协议', children: [] },
        { id: 'n_o2', text: '可作为 npm 组件使用', children: [] },
        { id: 'n_o3', text: '欢迎 Star', children: [] },
      ],
    },
  ],
}

function pickDataByHash(): MindMapNode {
  if (typeof location !== 'undefined' && location.hash === '#fan') return fanData
  if (typeof location !== 'undefined' && location.hash === '#stress') return stressData
  return initialData
}

// Test fixture: load a multi-branch dataset when the URL has #fan.
// Used by the verify smoke test to exercise the wide-fan path.
const fanData: MindMapNode = {
  id: 'root',
  text: 'z-mind 思维导图',
  children: [
    { id: 'n_a', text: '主题一', children: [] },
    { id: 'n_b', text: '主题二', children: [] },
    { id: 'n_c', text: '主题三', children: [] },
    { id: 'n_d', text: '主题四', children: [] },
    { id: 'n_e', text: '主题五', children: [] },
    { id: 'n_f', text: '主题六', children: [] },
    { id: 'n_g', text: '主题七', children: [] },
    { id: 'n_h', text: '主题八', children: [] },
    { id: 'n_i', text: '主题九', children: [] },
  ],
}

// Stress fixture: 7+7 root-level branches spread across a large
// vertical span, so the root-edge anchors / fan geometry is
// forced into its worst case. Used by the multi-branch stress
// test in scripts/stress.mjs.
const stressData: MindMapNode = (() => {
  const mk = (id: string, text: string): MindMapNode => ({ id, text, children: [] })
  const left = [
    mk('s_l1', '左一'),
    mk('s_l2', '左二'),
    mk('s_l3', '左三'),
    mk('s_l4', '左四'),
    mk('s_l5', '左五'),
    mk('s_l6', '左六'),
    mk('s_l7', '左七'),
  ]
  const right = [
    mk('s_r1', '右一'),
    mk('s_r2', '右二'),
    mk('s_r3', '右三'),
    mk('s_r4', '右四'),
    mk('s_r5', '右五'),
    mk('s_r6', '右六'),
    mk('s_r7', '右七'),
  ]
  return { id: 'root', text: 'z-mind 思维导图', children: [...left, ...right] }
})()

const data = ref<MindMapNode>(pickDataByHash())
const selectedNode = ref<MindMapNode | null>(null)
const collapsedIds = ref<Set<string>>(new Set())
const showOutline = ref(false)
const showData = ref(false)
const showMarkdown = ref(false)
const showSettings = ref(false)
// Preview mode: hides the entire app chrome (top toolbar, node
// count tip, drawer handle buttons, the MindMap's own toolbar /
// settings panel) and shows only the canvas + the outline.
// Toggled by the eye button in the top toolbar.
const previewMode = ref(false)
const mindMapRef = ref<InstanceType<typeof MindMap> | null>(null)

// React to URL hash changes so the verify smoke test (and a manual
// reload) can switch to the multi-branch fan fixture.
function syncHashData() {
  data.value = pickDataByHash()
}

// Local mirror of the MindMap settings; we apply changes by calling
// applySettings on the component.  The initial state matches the
// MindMap's own defaults so the UI is consistent.
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
    autoBalanceOnChange: true,
    lineWidthStart: 12.0,
    lineWidthEnd: 0.6,
    rainbowBranch: true,
    lineStyle: 'curve',
    layoutMode: 'mindmap',
    taperedEdge: true,
    showOrderBadge: false,
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
  if (e.key === 'Escape') {
    if (showSettings.value) {
      showSettings.value = false
      e.stopPropagation()
      return
    }
    if (previewMode.value) {
      previewMode.value = false
      e.stopPropagation()
    }
  }
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('hashchange', syncHashData)
  // Push initial settings to the MindMap so the rainbow / line-width
  // defaults take effect on first render.
  mindMapRef.value?.applySettings({
    rainbowBranch: settings.rainbowBranch,
    lineWidthStart: settings.lineWidthStart,
    lineWidthEnd: settings.lineWidthEnd,
    lineStyle: settings.lineStyle,
  })
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('hashchange', syncHashData)
})

function onChange(next: MindMapNode) {
  data.value = next
}

function onSelect(node: MindMapNode | null) {
  selectedNode.value = node
}

function onOutlineSelect(node: MindMapNode) {
  // Drive the canvas's selection by clicking the matching node
  // programmatically.  The canvas emits its own `select` on node
  // click, so App.onSelect (which only mirrors `selectedNode`
  // for the data panel) updates from there.  Earlier this
  // function also called mindMapRef.value?.resetView(), but
  // that snapped the view back to fit on every outline
  // interaction — way too aggressive when the user has
  // zoomed in.  The MindMap manages its own selection
  // internally now, so we just need to forward the click.
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

function onOutlineEdit(payload: { id: string; text: string }) {
  mindMapRef.value?.setNodeText(payload.id, payload.text)
}
function onOutlineAddChild(id: string) {
  mindMapRef.value?.addChild(id)
}
function onOutlineAddSibling(id: string) {
  mindMapRef.value?.addSibling(id)
}
function onOutlineMove(payload: { srcId: string; targetId: string; position: 'before' | 'after' | 'child' }) {
  mindMapRef.value?.moveNode(payload.srcId, payload.targetId, payload.position)
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
        @edit="onOutlineEdit"
        @add-child="onOutlineAddChild"
        @add-sibling="onOutlineAddSibling"
        @move="onOutlineMove"
      />
    </Drawer>

    <main class="zm-app-main">
      <div v-if="!previewMode" class="zm-app-toolbar">        <button
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
          @click="showData = true; showMarkdown = false"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </button>
        <button
          v-if="!showMarkdown"
          class="zm-app-icon-btn"
          title="显示 Markdown"
          @click="showMarkdown = true; showData = false"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 7 V4 H20 V7" />
            <path d="M9 20 H15" />
            <path d="M12 4 V20" />
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
        <button
          class="zm-app-icon-btn"
          :class="{ 'is-on': previewMode }"
          title="进入预览模式"
          @click="previewMode = true"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
      <!-- Preview-mode exit button: a small pill that sits over the
           canvas so the user can always leave preview mode. -->
      <button
        v-if="previewMode"
        class="zm-app-preview-exit"
        title="退出预览 (Esc)"
        @click="previewMode = false"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </svg>
      </button>
      <div class="zm-app-canvas">
        <MindMap
          ref="mindMapRef"
          :data="data"
          :preview-mode="previewMode"
          @change="onChange"
          @select="onSelect"
        />
      </div>
    </main>

    <Drawer
      side="right"
      :width="360"
      :open="showData && !previewMode"
      title="数据"
      @update:open="(v) => (showData = v)"
    >
      <DataPanel
        :data="data"
        @import="(d) => (data = d)"
      />
    </Drawer>

    <!-- Markdown ↔ 导图: 双向编辑。  与"数据"抽屉互斥 — 打开
         本抽屉会关闭"数据"抽屉，反之亦然 — 否则两个右抽屉并排
         会把画布挤得很难看。 -->
    <Drawer
      side="right"
      :width="420"
      :open="showMarkdown && !previewMode"
      title="Markdown"
      @update:open="(v) => (showMarkdown = v)"
    >
      <MarkdownPanel
        :data="data"
        @import="(d) => (data = d)"
      />
    </Drawer>

    <!-- Settings: floating popover anchored at the toolbar, toggled by
         the gear button.  Sits above the canvas so it doesn't compete
         with the persistent side drawers. -->
    <div v-if="showSettings && !previewMode" class="zm-settings-backdrop" @click="showSettings = false" />
    <div v-if="showSettings && !previewMode" class="zm-settings-popover" @click.stop>
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
.zm-app-icon-btn.is-on {
  background: #e0e7ff;
  color: #4338ca;
}
.zm-app-preview-exit {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  width: 32px;
  height: 32px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #475569;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
  transition: background 0.1s, color 0.1s, transform 0.1s;
}
.zm-app-preview-exit:hover {
  background: #f1f5f9;
  color: #0f172a;
  transform: scale(1.05);
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
