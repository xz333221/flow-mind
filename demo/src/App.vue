<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { MindMap } from 'flow-mindmap'
import 'flow-mindmap/style.css'
import type { MindMapNode, MindMapSettings, NodeStyle, BranchPalette } from 'flow-mindmap'

// =====================================================================
// Initial data — used for "reset" and as the default tree.
// =====================================================================
const initialData: MindMapNode = {
  id: 'root',
  text: 'flow-mindmap 消费测试',
  children: [
    {
      id: 'a', text: '核心功能', children: [
        { id: 'a1', text: '节点增删改', children: [] },
        { id: 'a2', text: '拖拽布局', children: [] },
        { id: 'a3', text: '缩放与平移', children: [] },
      ],
    },
    {
      id: 'b', text: '扩展', children: [
        { id: 'b1', text: '节点图片', children: [] },
        { id: 'b2', text: '超链接', children: [] },
        { id: 'b3', text: '节点笔记', children: [] },
      ],
    },
    {
      id: 'c', text: '设置', children: [
        { id: 'c1', text: '布局模式', children: [] },
        { id: 'c2', text: '连线样式', children: [] },
        { id: 'c3', text: '彩虹分支', children: [] },
      ],
    },
  ],
}

const data = ref<MindMapNode>(initialData)
const mmRef = ref<InstanceType<typeof MindMap> | null>(null)
const selectedId = ref<string | null>(null)
const lastEvent = ref<string>('(none)')
const readOnly = ref(false)
const previewMode = ref(false)
const theme = reactive({
  rootBg: '#0f172a',
  rootText: '#ffffff',
  branchBg: '#ffffff',
  branchText: '#1e293b',
  bgColor: '#f8fafc',
  fontSize: 14,
  lineWidthStart: 12,
  lineWidthEnd: 0.6,
  rainbowBranch: true,
})
// Demo-side state for the new props.  `markdown` is bound to
// MindMap's `markdown` prop; typing in the textarea updates the
// dataRef via MindMap's internal parser.  `lineColors` overrides the
// palette; empty string falls back to the active palette.
const markdownInput = ref<string>('')
const lastMarkdownEmitted = ref<string>('')
const lineColorsInput = ref<string>('')

const settings = reactive<MindMapSettings>({
  autoBalanceOnChange: true,
  lineWidthStart: 12,
  lineWidthEnd: 0.6,
  rainbowBranch: true,
  branchPaletteId: 'default',
  customPalettes: [],
  lineStyle: 'curve',
  layoutMode: 'mindmap',
  taperedEdge: true,
  showOrderBadge: false,
})

// History snapshots: read undo/redo state from the component.
const canUndo = ref(false)
const canRedo = ref(false)
function refreshHistoryFlags() {
  canUndo.value = mmRef.value?.canUndo() ?? false
  canRedo.value = mmRef.value?.canRedo() ?? false
}

const onChange = (d: MindMapNode) => {
  data.value = d
  refreshHistoryFlags()
  lastEvent.value = `change — ${countNodes(d)} 节点`
}
const onSelect = (n: MindMapNode | null) => {
  selectedId.value = n?.id ?? null
  lastEvent.value = n ? `select — ${n.id} (${n.text})` : 'select — null'
}
const onEditNote = (id: string) => {
  lastEvent.value = `edit-note — ${id}`
}
const onMarkdownChange = (md: string) => {
  lastMarkdownEmitted.value = md
  lastEvent.value = `markdownChange — ${md.length} chars`
}

function applyMarkdown() {
  // Re-parse the textarea content and replace the data tree.
  // Suppresses the markdownChange echo by passing false, since the
  // user is the one driving the change.
  mmRef.value?.setMarkdown(markdownInput.value, false)
  lastEvent.value = `setMarkdown — ${markdownInput.value.length} chars`
}

function applyLineColors() {
  // Empty string → fall back to palette; otherwise parse a
  // comma-separated list of hex codes / rgb() / names.
  const raw = lineColorsInput.value.trim()
  if (!raw) {
    lineColorsInput.value = ''
    return
  }
  // Just trust the browser's <input> to keep typed commas — MindMap
  // handles per-line trimming internally.  We push the raw string
  // back into a ref that the template binds as :line-colors.
}

const lineColorsList = computed<string[]>(() => {
  const raw = lineColorsInput.value.trim()
  if (!raw) return []
  return raw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean)
})

function countNodes(n: MindMapNode): number {
  return 1 + n.children.reduce((acc, c) => acc + countNodes(c), 0)
}

const totalNodes = computed(() => countNodes(data.value))

function log(name: string, payload?: unknown) {
  // eslint-disable-next-line no-console
  console.log('[demo]', name, payload)
  refreshHistoryFlags()
}

// =====================================================================
// Action helpers — each one calls one expose method and reports the
// result through `lastEvent` for the Playwright probe to scrape.
// =====================================================================
function act(name: string, fn: () => void) {
  try {
    fn()
    lastEvent.value = `${name} — ok (${totalNodes.value} 节点)`
  } catch (e) {
    lastEvent.value = `${name} — ERR: ${(e as Error).message}`
  }
  refreshHistoryFlags()
}

function actGet<T>(name: string, fn: () => T): T | undefined {
  try {
    const v = fn()
    lastEvent.value = `${name} — ${JSON.stringify(v).slice(0, 200)}`
    return v
  } catch (e) {
    lastEvent.value = `${name} — ERR: ${(e as Error).message}`
    return undefined
  }
}

const selectedNode = computed(() => {
  if (!selectedId.value) return null
  return findNode(data.value, selectedId.value) ?? null
})

function findNode(root: MindMapNode, id: string): MindMapNode | null {
  if (root.id === id) return root
  for (const c of root.children) {
    const r = findNode(c, id)
    if (r) return r
  }
  return null
}

// Expose a tiny test API on window for the Playwright driver to call
// without UI clicks.  Each method mirrors one of the library's
// expose methods; Playwright reads the visible `data-*` attribute
// surfaces and the `lastEvent` text for assertions.
declare global {
  interface Window {
    __demo: {
      getSelected: () => string | null
      getTotalNodes: () => number
      getLastEvent: () => string
      getDataJson: () => string
      getSettings: () => MindMapSettings
      getNodeText: (id: string) => string | undefined
      getNodeLink: (id: string) => string | undefined
      getNodeNote: (id: string) => string | undefined
      getNodeStyle: (id: string) => NodeStyle
      getCurrentPalette: () => string
      getPalettes: () => BranchPalette[]
      getMarkdown: () => string
      getLastMarkdownEmitted: () => string
      getFontSize: () => number
      setMarkdownEcho: (md: string) => void
    }
  }
}

onMounted(() => {
  window.__demo = {
    getSelected: () => selectedId.value,
    getTotalNodes: () => totalNodes.value,
    getLastEvent: () => lastEvent.value,
    getDataJson: () => JSON.stringify(data.value),
    getSettings: () => mmRef.value?.getSettings() ?? settings,
    getNodeText: (id) => findNode(data.value, id)?.text,
    getNodeLink: (id) => findNode(data.value, id)?.link?.url,
    getNodeNote: (id) => findNode(data.value, id)?.note?.text,
    getNodeStyle: (id) => mmRef.value?.getNodeStyle(id) ?? {},
    getCurrentPalette: () => mmRef.value?.getBranchPalette() ?? '',
    getPalettes: () => mmRef.value?.getBranchPalettes() ?? [],
    getMarkdown: () => mmRef.value?.getMarkdown() ?? '',
    getLastMarkdownEmitted: () => lastMarkdownEmitted.value,
    getFontSize: () => theme.fontSize,
    setMarkdownEcho: (md: string) => mmRef.value?.setMarkdown(md, true),
  }
})
onBeforeUnmount(() => {
  // Strict-mode `delete obj.prop` errors on non-optional interface
  // members; cast to a plain record so the wipe is type-safe.
  delete (window as unknown as Record<string, unknown>).__demo
})
</script>

<template>
  <div class="demo">
    <header class="demo-header">
      <h1>flow-mindmap consumer demo</h1>
      <span class="demo-status">
        节点: <b data-testid="total-nodes">{{ totalNodes }}</b> ·
        选中: <b data-testid="selected-id">{{ selectedId ?? '∅' }}</b> ·
        最后事件: <b data-testid="last-event">{{ lastEvent }}</b>
      </span>
    </header>

    <main class="demo-main">
      <aside class="demo-panel">
        <section>
          <h2>Props</h2>
          <label>
            <input type="checkbox" v-model="readOnly" data-testid="prop-readonly" />
            readonly
          </label>
          <label>
            <input type="checkbox" v-model="previewMode" data-testid="prop-preview" />
            previewMode
          </label>
        </section>

        <section>
          <h2>Settings</h2>
          <label>
            layoutMode:
            <select v-model="settings.layoutMode" data-testid="set-layoutmode" @change="mmRef?.applySettings({ layoutMode: settings.layoutMode })">
              <option value="mindmap">mindmap</option>
              <option value="tree">tree</option>
              <option value="org">org</option>
            </select>
          </label>
          <label>
            lineStyle:
            <select v-model="settings.lineStyle" data-testid="set-linestyle" @change="mmRef?.applySettings({ lineStyle: settings.lineStyle })">
              <option value="curve">curve</option>
              <option value="straight">straight</option>
            </select>
          </label>
          <label>
            <input type="checkbox" v-model="settings.rainbowBranch" data-testid="set-rainbow" @change="mmRef?.applySettings({ rainbowBranch: settings.rainbowBranch })" />
            rainbowBranch
          </label>
          <label>
            <input type="checkbox" v-model="settings.taperedEdge" data-testid="set-tapered" @change="mmRef?.applySettings({ taperedEdge: settings.taperedEdge })" />
            taperedEdge
          </label>
          <label>
            <input type="checkbox" v-model="settings.showOrderBadge" data-testid="set-orderbadge" @change="mmRef?.applySettings({ showOrderBadge: settings.showOrderBadge })" />
            showOrderBadge
          </label>
          <label>
            branchPaletteId:
            <select :value="settings.branchPaletteId" data-testid="set-palette" @change="(e) => { settings.branchPaletteId = (e.target as HTMLSelectElement).value; mmRef?.setBranchPalette(settings.branchPaletteId) }">
              <option value="default">default</option>
              <option value="classic">classic</option>
              <option value="vivid">vivid</option>
              <option value="dev">dev</option>
              <option value="mint">mint</option>
            </select>
          </label>
        </section>

        <section>
          <h2>Node ops (expose)</h2>
          <button data-testid="op-addchild" :disabled="!selectedId" @click="act('addChild', () => { if (selectedId) mmRef?.addChild(selectedId) })">addChild(选中)</button>
          <button data-testid="op-addsibling" :disabled="!selectedId || selectedId === 'root'" @click="act('addSibling', () => { if (selectedId) mmRef?.addSibling(selectedId) })">addSibling(选中)</button>
          <button data-testid="op-remove" :disabled="!selectedId || selectedId === 'root'" @click="act('removeNode', () => { if (selectedId) mmRef?.removeNode(selectedId) })">removeNode(选中)</button>
          <button data-testid="op-duplicate" :disabled="!selectedId" @click="act('duplicateNode', () => { if (selectedId) mmRef?.duplicateNode(selectedId) })">duplicateNode(选中)</button>
          <button data-testid="op-settext" :disabled="!selectedId" @click="act('setNodeText', () => { if (selectedId) mmRef?.setNodeText(selectedId, `编辑于 ${Date.now() % 10000}`) })">setNodeText(选中)</button>
          <button data-testid="op-move" :disabled="!selectedNode" @click="act('moveNode → root child', () => { if (selectedId && selectedId !== 'root') mmRef?.moveNode(selectedId, 'root', 'child') })">moveNode(选中 → root 子)</button>
        </section>

        <section>
          <h2>Node extension</h2>
          <button data-testid="op-style" :disabled="!selectedId" @click="act('applyNodeStyle', () => { if (selectedId) mmRef?.applyNodeStyle(selectedId, { bg: '#fef08a', borderColor: '#ca8a04', fontWeight: 600 }) })">applyNodeStyle(高亮)</button>
          <button data-testid="op-style-clear" :disabled="!selectedId" @click="act('applyNodeStyle(clear)', () => { if (selectedId) mmRef?.applyNodeStyle(selectedId, {}) })">applyNodeStyle(清除)</button>
          <button data-testid="op-link" :disabled="!selectedId" @click="act('applyNodeLink', () => { if (selectedId) mmRef?.applyNodeLink(selectedId, 'https://example.com') })">applyNodeLink</button>
          <button data-testid="op-link-clear" :disabled="!selectedId" @click="act('removeNodeLink', () => { if (selectedId) mmRef?.removeNodeLink(selectedId) })">removeNodeLink</button>
          <button data-testid="op-note" :disabled="!selectedId" @click="act('applyNodeNote', () => { if (selectedId) mmRef?.applyNodeNote(selectedId, 'demo note text') })">applyNodeNote</button>
          <button data-testid="op-note-clear" :disabled="!selectedId" @click="act('removeNodeNote', () => { if (selectedId) mmRef?.removeNodeNote(selectedId) })">removeNodeNote</button>
        </section>

        <section>
          <h2>View</h2>
          <button data-testid="op-resetview" @click="act('resetView', () => mmRef?.resetView())">resetView()</button>
          <button data-testid="op-getdata" @click="actGet('getData', () => { const d = mmRef?.getData(); return { nodes: d ? countNodes(d) : 0 } })">getData()</button>
          <button data-testid="op-setdata" @click="act('setData(initialData)', () => mmRef?.setData(initialData))">setData(initial)</button>
        </section>

        <section>
          <h2>History</h2>
          <button data-testid="op-undo" :disabled="!canUndo" @click="act('undo', () => mmRef?.undo())">undo</button>
          <button data-testid="op-redo" :disabled="!canRedo" @click="act('redo', () => mmRef?.redo())">redo</button>
        </section>

        <section>
          <h2>Import/Export</h2>
          <button data-testid="op-export" @click="actGet('exportData', () => mmRef?.exportData()?.slice(0, 80))">exportData()</button>
          <button data-testid="op-import" @click="act('importData', () => { const ok = mmRef?.importData(mmRef?.exportData() ?? '{}'); return ok })">importData(exportData)</button>
        </section>

        <section>
          <h2>Theme</h2>
          <label>fontSize <input data-testid="theme-fontsize" type="number" v-model.number="theme.fontSize" min="10" max="32" /></label>
          <small style="color:#64748b;font-size:11px">节点大小会按 fontSize/14 等比缩放</small>
        </section>

        <section>
          <h2>Markdown</h2>
          <textarea
            data-testid="markdown-input"
            v-model="markdownInput"
            rows="5"
            placeholder="粘贴 markdown 内容,点击 setMarkdown 替换数据"
            style="width:100%;font-family:ui-monospace,monospace;font-size:11px;padding:4px"
          ></textarea>
          <button data-testid="op-setmarkdown" @click="applyMarkdown">setMarkdown(textarea)</button>
          <small style="color:#64748b;font-size:11px">已回传的 markdown: <span data-testid="md-emitted-len">{{ lastMarkdownEmitted.length }}</span> chars</small>
        </section>

        <section>
          <h2>lineColors</h2>
          <textarea
            data-testid="linecolors-input"
            v-model="lineColorsInput"
            rows="2"
            placeholder="逗号或换行分隔:#f87171, #34d399, #60a5fa"
            style="width:100%;font-family:ui-monospace,monospace;font-size:11px;padding:4px"
          ></textarea>
          <small style="color:#64748b;font-size:11px">留空 = 走 palette。优先级: lineColors &gt; branchPaletteId</small>
        </section>
      </aside>

      <section class="demo-canvas" :class="{ readonly: readOnly, preview: previewMode }">
        <MindMap
          ref="mmRef"
          :data="data"
          :readonly="readOnly"
          :preview-mode="previewMode"
          :theme="theme"
          :line-colors="lineColorsList"
          @change="onChange"
          @select="onSelect"
          @edit-note="onEditNote"
          @markdown-change="onMarkdownChange"
          style="width: 100%; height: 100%"
        />
      </section>
    </main>
  </div>
</template>

<style>
html, body, #app { margin: 0; padding: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.demo { display: flex; flex-direction: column; height: 100%; }
.demo-header { padding: 8px 14px; background: #0f172a; color: #f1f5f9; display: flex; gap: 16px; align-items: center; }
.demo-header h1 { font-size: 14px; margin: 0; font-weight: 600; }
.demo-status { font-size: 12px; color: #cbd5e1; }
.demo-status b { color: #f8fafc; font-weight: 600; margin-right: 6px; }
.demo-main { display: flex; flex: 1; min-height: 0; }
.demo-panel { width: 320px; border-right: 1px solid #e2e8f0; background: #ffffff; overflow-y: auto; padding: 8px 12px 24px; flex-shrink: 0; }
.demo-panel h2 { font-size: 12px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; margin: 14px 0 6px; }
.demo-panel section + section { border-top: 1px dashed #e2e8f0; }
.demo-panel label { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 2px 0; }
.demo-panel select, .demo-panel input[type="number"] { flex: 1; padding: 2px 4px; font: inherit; }
.demo-panel button { display: block; width: 100%; text-align: left; padding: 4px 8px; margin: 2px 0; font: inherit; font-size: 12px; border: 1px solid #cbd5e1; background: #f8fafc; color: #1e293b; border-radius: 4px; cursor: pointer; }
.demo-panel button:hover:not(:disabled) { background: #e0e7ff; border-color: #818cf8; }
.demo-panel button:disabled { opacity: 0.4; cursor: not-allowed; }
.demo-canvas { flex: 1; position: relative; min-width: 0; background: #f8fafc; }
</style>
