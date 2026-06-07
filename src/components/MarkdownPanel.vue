<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import type { MindMapNode } from '../types'
import { markdownToMindMap, mindMapToMarkdown, clone } from '../tree'
import MindMap from './MindMap.vue'

const props = defineProps<{
  /** Current data tree.  Used to populate the editor on first mount
   *  (as markdown) and as the source of the "export .md" action. */
  data: MindMapNode
}>()

const emit = defineEmits<{
  /** Fired when the user clicks "应用到导图": the textarea content,
   *  parsed via `markdownToMindMap`, is sent up to replace the
   *  current data tree. */
  (e: 'import', data: MindMapNode): void
}>()

const mdText = ref(mindMapToMarkdown(props.data))
const parseError = ref<string | null>(null)
const previewRef = ref<InstanceType<typeof MindMap> | null>(null)

/** Sync the editor when the upstream data changes (e.g. user clicks
 *  "应用" then makes a tweak on the canvas — we don't want to clobber
 *  the user's markdown with the new tree).  We only seed the editor
 *  on first mount via the ref initializer; after that, the editor is
 *  the source of truth. */

// Live preview: parse the current markdown text.  We parse on every
// keystroke — the parser is cheap, and a fresh preview after each
// stroke is the right UX for an editor.
const previewDataRaw = computed<MindMapNode>(() => {
  try {
    const parsed = markdownToMindMap(mdText.value || '')
    parseError.value = null
    return parsed
  } catch (e) {
    parseError.value = (e as Error).message
    // Fallback: empty tree so the preview pane doesn't go blank.
    return { id: 'preview_fallback', text: mdText.value || '(空)', children: [] }
  }
})
// Defensive clone so the MindMap's internal `dataRef = ref(clone(props.data))`
// gets a fresh tree identity on every preview change — important so the
// MindMap's history stack and layoutVersion don't get confused by repeated
// `data` references that share subtree objects.
const previewData = computed(() => clone(previewDataRaw.value))

// Reset the preview's view whenever the user finishes editing —
// otherwise the preview keeps the last zoom/pan across edits.
let resetTimer: ReturnType<typeof setTimeout> | null = null
watch(mdText, () => {
  if (resetTimer) clearTimeout(resetTimer)
  resetTimer = setTimeout(() => previewRef.value?.resetView(), 250)
})

function applyToData() {
  try {
    const parsed = markdownToMindMap(mdText.value || '')
    parseError.value = null
    emit('import', parsed)
  } catch (e) {
    parseError.value = (e as Error).message
  }
}

function syncFromData() {
  // Push the current data tree into the editor, replacing whatever
  // the user was typing.  This is what "Revert" / "Reset" does.
  mdText.value = mindMapToMarkdown(props.data)
  parseError.value = null
  nextTick(() => previewRef.value?.resetView())
}

function clearAll() {
  mdText.value = ''
  parseError.value = null
  nextTick(() => previewRef.value?.resetView())
}

function loadFromFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.md,text/markdown,text/plain'
  input.onchange = () => {
    const f = input.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        mdText.value = reader.result
        parseError.value = null
        nextTick(() => previewRef.value?.resetView())
      }
    }
    reader.readAsText(f)
  }
  input.click()
}

function exportToFile() {
  const blob = new Blob([mdText.value], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const stem = (props.data.text || 'mindmap').trim() || 'mindmap'
  a.download = `${stem}.md`
  a.click()
  URL.revokeObjectURL(url)
}

/** Template for an empty editor — gives the user a starting point.
 *  Showcases every feature: image (banner at the top), link (the
 *  GitHub pointer on the root), note (the "what's this" block on
 *  项目概览), and a moderately wide tree so the preview isn't
 *  just one path.  Image URLs use placehold.co so the demo works
 *  anywhere without bundling assets. */
const STARTER = `# flow-mind 思维导图

[GitHub 仓库](https://github.com/xuze/flow-mind)

![cover](https://placehold.co/600x300/3b82f6/ffffff?text=flow-mind+demo)

## 项目概览
一个现代、极简的思维导图工具 — xmind 风格，可作为 Vue 组件嵌入。

\`\`\`note
这个 note 节点演示了多行笔记：
- 节点旁的笔记图标
- hover 显示 tooltip 预览
- 点击图标进入内联编辑
- 支持任意多行文本
\`\`\`

## 核心功能

### 节点编辑
- 增、删、改
- 拖拽布局

### 视图
- 缩放与平移
- 多种布局模式

### 数据
- 导入 / 导出 JSON
- 撤销 / 重做

## 技术栈
- Vue 3 + Vite
- TypeScript
- 纯 SVG 渲染
- 零第三方运行时依赖

## 开源协议
[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)
`

function loadStarter() {
  mdText.value = STARTER
  parseError.value = null
  nextTick(() => previewRef.value?.resetView())
}
</script>

<template>
  <div class="zm-md-panel">
    <div class="zm-md-toolbar">
      <button class="zm-md-btn" title="从 .md 文件加载" @click="loadFromFile">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 4 V15" />
          <polyline points="7 9 12 4 17 9" />
          <path d="M4 19 H20" />
        </svg>
        <span>加载 .md</span>
      </button>
      <button class="zm-md-btn" title="把当前导图导出为 .md" @click="exportToFile">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 15 V4" />
          <polyline points="7 9 12 4 17 9" />
          <path d="M4 19 H20" />
        </svg>
        <span>导出 .md</span>
      </button>
      <span class="zm-md-spacer" />
      <button class="zm-md-btn" title="用示例内容填充" @click="loadStarter">示例</button>
      <button class="zm-md-btn" title="覆盖为当前导图" @click="syncFromData">同步</button>
      <button class="zm-md-btn" title="清空" @click="clearAll">清空</button>
    </div>

    <div class="zm-md-error" v-if="parseError">{{ parseError }}</div>

    <div class="zm-md-split">
      <div class="zm-md-edit">
        <div class="zm-md-pane-header">
          <span>Markdown</span>
          <span class="zm-md-hint"># 根 · ## 一级 · ### 二级 …</span>
        </div>
        <textarea
          v-model="mdText"
          class="zm-md-textarea"
          spellcheck="false"
          placeholder="# 标题…"
        />
      </div>

      <div class="zm-md-preview">
        <div class="zm-md-pane-header">
          <span>导图预览</span>
          <span class="zm-md-hint">只读</span>
        </div>
        <div class="zm-md-preview-body">
          <MindMap
            ref="previewRef"
            :data="previewData"
            readonly
            preview-mode
          />
        </div>
      </div>
    </div>

    <div class="zm-md-footer">
      <button
        class="zm-md-btn is-primary"
        :disabled="!mdText.trim()"
        @click="applyToData"
      >应用到导图</button>
    </div>
  </div>
</template>

<style>
.zm-md-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f8fafc;
}
.zm-md-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid #f1f5f9;
  background: #f8fafc;
  flex-shrink: 0;
}
.zm-md-spacer {
  flex: 1;
}
.zm-md-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 12px;
  font-family: inherit;
  color: #475569;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.1s;
  white-space: nowrap;
}
.zm-md-btn:hover:not(:disabled) {
  background: #f1f5f9;
  color: #1e293b;
  border-color: #cbd5e1;
}
.zm-md-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.zm-md-btn.is-primary {
  background: #3b82f6;
  color: #ffffff;
  border-color: #3b82f6;
}
.zm-md-btn.is-primary:hover:not(:disabled) {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
}
.zm-md-error {
  padding: 6px 10px;
  font-size: 11px;
  color: #dc2626;
  background: #fef2f2;
  border-bottom: 1px solid #fee2e2;
  flex-shrink: 0;
}
.zm-md-split {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.zm-md-edit,
.zm-md-preview {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.zm-md-pane-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  color: #475569;
  background: #f1f5f9;
  border-bottom: 1px solid #e2e8f0;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
.zm-md-hint {
  margin-left: auto;
  font-weight: 400;
  color: #94a3b8;
  font-size: 10px;
}
.zm-md-textarea {
  flex: 1;
  width: 100%;
  padding: 10px 12px;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #1e293b;
  border: none;
  border-bottom: 1px solid #e2e8f0;
  background: #ffffff;
  resize: none;
  outline: none;
  box-sizing: border-box;
}
.zm-md-textarea:focus {
  background: #fafbfc;
}
.zm-md-preview-body {
  flex: 1;
  position: relative;
  min-height: 0;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
}
.zm-md-footer {
  display: flex;
  justify-content: flex-end;
  padding: 8px 10px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  flex-shrink: 0;
}
</style>
