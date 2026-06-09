<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, reactive } from 'vue'
import MindMap from './components/MindMap.vue'
import Drawer from './components/Drawer.vue'
import Outline from './components/Outline.vue'
import DataPanel from './components/DataPanel.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import MarkdownPanel from './components/MarkdownPanel.vue'
import NotePanel from './components/NotePanel.vue'
import type { MindMapNode, MindMapSettings } from './types'

// Sample data — same shape the user can pass in production.
const initialData: MindMapNode = {
  id: 'root',
  text: 'flow-mindmap 思维导图',
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

// Demo fixture for hash #rich: a hand-built tree that
// exercises every node-level field — image, code/table
// (rendered above the title via richContent), link, note —
// so reviewers can see the rendering at a glance without
// writing any markdown.
const richData: MindMapNode = {
  id: 'r_root',
  text: 'flow-mindmap 节点能力一览',
  // 根节点带外部链接
  link: { url: 'https://github.com/xz333221/flow-mindmap' },
  // 根节点带笔记(右上角图标)
  note: { text: '本导图用于演示节点的全部可渲染字段。\n所有代码块 / 表格在节点标题上方显示,不会撑大节点框。' },
  children: [
    {
      id: 'r_image',
      text: '嵌入图片',
      // 远程 SVG,作为节点的图片
      image: {
        src: 'data:image/svg+xml;utf8,' + encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40" width="80" height="40">' +
          '<rect width="80" height="40" rx="6" fill="#6366f1"/>' +
          '<text x="40" y="24" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="12" font-weight="600">LOGO</text>' +
          '</svg>'
        ),
        naturalW: 80,
        naturalH: 40,
        width: 80,
        height: 40,
      },
      children: [
        { id: 'r_image_a', text: '节点上方的图标 / logo', children: [] },
        { id: 'r_image_b', text: 'remote URL 或 data: URL', children: [] },
        { id: 'r_image_c', text: '可拖拽改尺寸', children: [] },
      ],
    },
    {
      id: 'r_code',
      text: '代码块',
      // 代码块 richContent.kind='code' — 渲染在节点标题上方
      richContent: {
        kind: 'code',
        lang: 'ts',
        raw: '```ts\nimport { MindMap } from "flow-mindmap"\nconst tree = MindMap.parse(md)\n```',
      },
      note: { text: '代码块以 richContent 形式携带,\n渲染在节点标题上方,自动支持语言 tag。' },
      link: { url: 'https://flow-mindmap.example/docs/api' },
      children: [
        {
          id: 'r_code_a',
          text: '等宽字体,自动换行',
          // 三级节点测试:JS 代码块
          richContent: {
            kind: 'code',
            lang: 'js',
            raw: '```js\nconst sum = (a, b) => a + b\nconsole.log(sum(1, 2)) // 3\n```',
          },
          children: [],
        },
        {
          id: 'r_code_b',
          text: '保留原始 ```lang 标签',
          // 三级节点测试:不同语言 (bash) 代码块
          richContent: {
            kind: 'code',
            lang: 'bash',
            raw: '```bash\nnpm install flow-mindmap\nnpm run dev\n```',
          },
          children: [],
        },
        {
          id: 'r_code_c',
          text: 'max-height 截断,框内可滚',
          // 三级节点测试:超长代码块验证滚动
          richContent: {
            kind: 'code',
            lang: 'ts',
            raw: '```ts\ninterface Node {\n  id: string\n  text: string\n  children: Node[]\n  collapsed?: boolean\n  image?: { src: string }\n  link?: { url: string }\n  note?: { text: string }\n  richContent?: RichContent\n}\nfunction walk(n: Node) {\n  console.log(n.id)\n  n.children.forEach(walk)\n}\n```',
          },
          children: [],
        },
      ],
    },
    {
      id: 'r_table',
      text: '表格',
      // 表格 richContent.kind='table' — 渲染在节点标题上方
      richContent: {
        kind: 'table',
        raw: '| 字段 | 类型 | 说明 |\n| --- | --- | --- |\n| id | string | 节点唯一 id |\n| text | string | 节点标题 |\n| children | MindMapNode[] | 子节点数组 |',
      },
      children: [
        {
          id: 'r_table_a',
          text: '自动识别 markdown 表格',
          // 三级节点测试:小表格 (2 列 × 3 行)
          richContent: {
            kind: 'table',
            raw: '| key | value |\n| --- | --- |\n| name | flow-mindmap |\n| version | 0.x |',
          },
          children: [],
        },
        {
          id: 'r_table_b',
          text: '忽略对齐分隔行',
          // 三级节点测试:含对齐符 (:---, :---:, ---:) 的表格
          richContent: {
            kind: 'table',
            raw: '| 左对齐 | 居中 | 右对齐 |\n| :--- | :---: | ---: |\n| L1 | C1 | R1 |\n| L2 | C2 | R2 |',
          },
          children: [],
        },
        {
          id: 'r_table_c',
          text: '保留所有行 / 所有列',
          // 三级节点测试:多列宽表格
          richContent: {
            kind: 'table',
            raw: '| a | b | c | d | e |\n| --- | --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 | 5 |\n| 6 | 7 | 8 | 9 | 10 |',
          },
          children: [],
        },
      ],
    },
    {
      id: 'r_note',
      text: '笔记 (note)',
      note: { text: '节点右上角的便签图标。\n鼠标悬浮预览前 60 字,点击打开完整笔记编辑器。' },
      children: [
        { id: 'r_note_a', text: '悬浮预览', children: [] },
        { id: 'r_note_b', text: '点击展开编辑', children: [] },
        { id: 'r_note_c', text: 'export → ```note 围栏', children: [] },
      ],
    },
    {
      id: 'r_link',
      text: '链接 (link)',
      link: { url: 'https://github.com/xz333221/flow-mindmap' },
      children: [
        { id: 'r_link_a', text: '节点右侧的小图标', children: [] },
        { id: 'r_link_b', text: '点击在新 tab 打开', children: [] },
        { id: 'r_link_c', text: 'export → [label](url)', children: [] },
      ],
    },
    {
      id: 'r_para',
      text: '段落 / 列表 (子节点)',
      // 这条路径在整篇 md 模式下自动启用 — 这里演示"块作为子节点"的视觉。
      children: [
        { id: 'r_para_a', text: '段落不再是父节点框内文字', children: [] },
        { id: 'r_para_b', text: '列表每项一个子节点', children: [] },
        { id: 'r_para_c', text: '节点框大小保持一致,边线对齐', children: [] },
      ],
    },
  ],
}

function pickDataByHash(): MindMapNode {
  if (typeof location !== 'undefined' && location.hash === '#fan') return fanData
  if (typeof location !== 'undefined' && location.hash === '#stress') return stressData
  if (typeof location !== 'undefined' && location.hash === '#rich') return richData
  // No hash → fall through to the "rich sample" (节点能力一览)
  // as the default demo.  Reviewers land on the page and
  // immediately see every renderable field (image / code / table
  // / note / link).  The simple 3-branch sample is still
  // available via the toolbar toggle.
  return richData
}

// Test fixture: load a multi-branch dataset when the URL has #fan.
// Used by the verify smoke test to exercise the wide-fan path.
const fanData: MindMapNode = {
  id: 'root',
  text: 'flow-mindmap 思维导图',
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
  return { id: 'root', text: 'flow-mindmap 思维导图', children: [...left, ...right] }
})()

const data = ref<MindMapNode>(richData)
const selectedNode = ref<MindMapNode | null>(null)
const collapsedIds = ref<Set<string>>(new Set())
const showOutline = ref(false)
const showData = ref(false)
const showMarkdown = ref(false)
const showNote = ref(false)
// `noteFocusTick` is bumped each time the user picks a node so
// the NotePanel can re-focus its textarea.  We don't tie the
// focus to a `v-if` remount because we want the drawer to stay
// mounted while the user is just moving between nodes — that
// way the slide-in animation doesn't replay on every click.
const noteFocusTick = ref(0)
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
  richMode.value = typeof location !== 'undefined' && location.hash === '#rich'
}

// "Rich sample" loader: replaces the current data with the
// hand-built tree that exercises every node-level field
// (image / code / table / note / link).  The button toggles
// back to the default sample on second click so reviewers can
// A/B compare.
// Default to the "节点能力一览" fixture so reviewers see every
// renderable field (image / code / table / note / link) on first
// load.  The toolbar button toggles back to the simple sample on
// the first click.
const richMode = ref(true)
function loadRichSample() {
  if (richMode.value) {
    data.value = initialData
    richMode.value = false
  } else {
    data.value = richData
    richMode.value = true
  }
}

// Local mirror of the MindMap settings; we apply changes by calling
// applySettings on the component.  The initial state matches the
// MindMap's own defaults so the UI is consistent.
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
    branchPaletteId: 'default',
    customPalettes: [],
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
    branchPaletteId: settings.branchPaletteId,
    customPalettes: settings.customPalettes,
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
  if (node) {
    // A node was just selected — open the note drawer so the
    // user can see / edit the note in context.  We do NOT bump
    // the focus tick here: stealing focus from the canvas on
    // every node click would make Tab / Enter shortcuts stop
    // working (the keydown listener skips events whose target
    // is an INPUT / TEXTAREA).  Focus only happens when the
    // user explicitly asks — see `onEditNote`.
    if (!showNote.value) {
      showData.value = false
      showMarkdown.value = false
      showNote.value = true
    }
  } else {
    // The user clicked empty canvas.  Close the note drawer
    // too — the panel is about to render its empty state
    // (because the panel's `selectedNode` is now null), and
    // a half-empty drawer is worse UX than no drawer.
    showNote.value = false
  }
}

// Keep `selectedNode` in sync with the data tree.  When the user
// edits a node's text (which mutates the same object MindMap holds
// in its `dataRef`), we need NotePanel to re-read the new text.
// This watcher also catches the case where the selected node is
// removed entirely (e.g. via the right-click "移除" action).
watch(data, (next) => {
  if (!selectedNode.value) return
  const found = findNodeInData(next, selectedNode.value.id)
  if (!found) {
    selectedNode.value = null
  } else if (found !== selectedNode.value) {
    // Identity changed (e.g. data tree was replaced via setData).
    // Replace the reference so the panel re-reads the new fields.
    selectedNode.value = found
  }
}, { deep: false })

function onEditNote(id: string) {
  // From MindMap's right-click "添加/编辑笔记" — make sure the
  // target node is the selected one (MindMap does this for us
  // via its context-menu handler) and open the drawer.
  if (!selectedNode.value || selectedNode.value.id !== id) {
    // Race condition: the click hasn't propagated through to
    // MindMap's `select` emit yet.  Look the node up and use it
    // directly so the drawer shows the right content.
    const n = findNodeInData(data.value, id)
    if (n) {
      selectedNode.value = n
    }
  }
  showData.value = false
  showMarkdown.value = false
  showNote.value = true
  noteFocusTick.value++
}

function findNodeInData(root: MindMapNode, id: string): MindMapNode | null {
  if (root.id === id) return root
  for (const c of root.children) {
    const r = findNodeInData(c, id)
    if (r) return r
  }
  return null
}

function onNoteApply(text: string) {
  if (!selectedNode.value) return
  mindMapRef.value?.applyNodeNote(selectedNode.value.id, text)
}
function onNoteRemove() {
  if (!selectedNode.value) return
  mindMapRef.value?.removeNodeNote(selectedNode.value.id)
}
function onLinkSet(url: string) {
  if (!selectedNode.value) return
  mindMapRef.value?.applyNodeLink(selectedNode.value.id, url)
}
function onImageSet(src: string) {
  if (!selectedNode.value) return
  mindMapRef.value?.applyNodeImageByUrl(selectedNode.value.id, src)
}
function onRichSet(payload: { kind: 'code' | 'table'; raw: string; lang?: string } | null) {
  if (!selectedNode.value) return
  mindMapRef.value?.applyNodeRichContent(selectedNode.value.id, payload)
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
          @click="showData = true; showMarkdown = false; showNote = false"
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
          @click="showMarkdown = true; showData = false; showNote = false"
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
          :class="{ 'is-on': richMode }"
          :title="richMode ? '切回默认示例 (3 分支)' : '切到节点能力一览 (图片/代码/表格/笔记/链接)'"
          @click="loadRichSample"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>
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
          @edit-note="onEditNote"
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

    <!-- 笔记抽屉：选中节点时自动打开，承载每个节点的 note
         编辑/查看。同样与"数据"/"Markdown"互斥。 -->
    <Drawer
      side="right"
      :width="360"
      :open="showNote && !previewMode"
      title="节点内容"
      @update:open="(v) => (showNote = v)"
    >
      <NotePanel
        :selected-node="selectedNode"
        :readonly="false"
        :focus-tick="noteFocusTick"
        @apply="onNoteApply"
        @remove="onNoteRemove"
        @set-link="onLinkSet"
        @set-image="onImageSet"
        @set-rich="onRichSet"
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
