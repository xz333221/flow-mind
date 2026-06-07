# flow-mindmap

A modern, minimalist mind mapping tool — xmind-style, embeddable as a Vue 3 component.

- 纯 SVG 渲染,矢量缩放无损
- 拖拽、缩放、平移画布
- 键盘快捷键: `Tab` 添加子节点 / `Enter` 添加同级 / `F2` 编辑 / `Delete` 删除节点
- 一键折叠/展开子树
- 多种布局模式: mindmap(默认) / tree(右向树) / org(向下组织结构)
- 可调画板: 渐变锥形连线、彩虹分支、节点背景/边框/字体样式、嵌入图片、超链接、节点笔记
- 撤销/重做、JSON 导入导出
- 扁平化 SVG 线框图标,无任何 Emoji
- Apache-2.0 开源协议,可在 npm 安装作为组件使用

## 安装

```bash
pnpm add flow-mindmap
```

## 快速开始

### 全局注册(Vue 插件)

```ts
import { createApp } from 'vue'
import App from './App.vue'
import FlowMindmap from 'flow-mindmap'
import 'flow-mindmap/style.css'

const app = createApp(App)
app.use(FlowMindmap) // 注册为 <FlowMindMap />
app.mount('#app')
```

```vue
<template>
  <FlowMindMap :data="data" style="width: 100vw; height: 100vh" />
</template>
```

### 局部导入

```vue
<script setup lang="ts">
import { MindMap } from 'flow-mindmap'
import 'flow-mindmap/style.css'
import type { MindMapNode } from 'flow-mindmap'

const data: MindMapNode = {
  id: 'root',
  text: '中心主题',
  children: [
    { id: 'a', text: '分支 A', children: [] },
    { id: 'b', text: '分支 B', children: [] },
  ],
}
</script>

<template>
  <MindMap :data="data" style="width: 100vw; height: 100vh" />
</template>
```

### 从 Markdown 渲染

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { MindMap } from 'flow-mindmap'
import 'flow-mindmap/style.css'

const md = ref(`# 项目计划

## 第一阶段

调研 / 设计

## 第二阶段

实现

## 第三阶段

上线`)

// 监听变化把 markdown 同步回外部存储(可选)
function onMdChange(next: string) {
  // 写入 localStorage / autosave / 远端等
  console.log('md changed, length =', next.length)
}
</script>

<template>
  <MindMap
    :markdown="md"
    :theme="{ fontSize: 16, rainbowBranch: true }"
    :line-colors="['#5eead4', '#fbbf24', '#f472b6', '#a78bfa']"
    @markdown-change="onMdChange"
    style="width: 100vw; height: 100vh"
  />
</template>
```

`markdown` prop 接受标准 markdown:`# / ## / ###` 作为节点层级;紧跟 heading 的 `[label](url)` 作为节点的 link;` ```note ... ``` ` 围栏作为节点的 note;`![alt](url)` 作为图片。改节点文字会自动 emit `markdownChange`,你可以把它写回输入框或远端。

## Props

| Prop | Type | Default | 说明 |
| ---- | ---- | ------- | ---- |
| `data` | [`MindMapNode`](#数据类型) | — | **必填**。思维导图根节点。 |
| `readonly` | `boolean` | `false` | 只读模式:禁用增删改、拖拽、编辑输入框。 |
| `previewMode` | `boolean` | `false` | 预览模式:隐藏画布自带工具栏,只保留节点和折叠/调整手柄。适合做截图、嵌入展示。 |
| `theme` | [`MindMapTheme`](#数据类型) | — | 主题色/字号/连线粗细等外观配置,见下表。 |
| `markdown` | `string` | — | 可选:传入 markdown 文本,内部解析为 `data`。**与 `data` 二选一**,传了 `markdown` 后 `data` 被忽略。双向同步:数据变化时通过 `markdownChange` 事件回传序列化结果。 |
| `lineColors` | `string[]` | — | 可选:顶层分支**连线**颜色列表(hex / rgb / 命名色)。优先级高于 `branchPaletteId` / `customPalettes`;留空走 palette 流程。 |

### `MindMapTheme` 字段

| 字段 | 类型 | 默认 | 说明 |
| ---- | ---- | ---- | ---- |
| `rootBg` | `string` | — | 根节点背景色 |
| `rootText` | `string` | — | 根节点文字色 |
| `branchBg` | `string` | — | 普通节点背景色 |
| `branchText` | `string` | — | 普通节点文字色 |
| `lineColor` | `string` | — | 连线颜色 |
| `bgColor` | `string` | — | 画布背景色 |
| `fontSize` | `number` | `14` | 基础字号(px)。**节点的实际尺寸(高度/最小宽度/内边距/文本宽度)会按 `fontSize / 14` 等比缩放**——`fontSize=28` 时所有节点都会变成两倍大;`fontSize=10` 时一半。 |
| `lineWidthStart` | `number` | `2.2` | 父端连线粗细(px) |
| `lineWidthEnd` | `number` | `0.8` | 子端连线粗细(px) |
| `rainbowBranch` | `boolean` | `false` | 顶层分支按色板循环配色 |

## Emits

| 事件 | 载荷 | 说明 |
| ---- | ---- | ---- |
| `change` | `MindMapNode` | 数据变更(增删改、导入、拖动)后触发,载荷是**新的整棵根节点**。 |
| `select` | `MindMapNode \| null` | 用户点击节点时触发;`null` 表示点空白处取消选中。 |
| `edit-note` | `nodeId: string` | 用户点击节点笔记图标 / 右键"添加/编辑笔记"时触发,由父组件决定如何展示笔记编辑界面。 |
| `markdownChange` | `markdown: string` | 当使用了 `markdown` prop 且内部数据变化时触发,载荷是重新序列化后的 markdown 文本。`markdown` prop 写入触发时**不会**回环 emit。 |

## Expose 方法(通过 `ref` 访问)

```vue
<MindMap ref="mm" :data="data" />
<script setup>
const mm = ref()
mm.value.addChild('a') // 给 id=a 的节点加一个子节点
</script>
```

### 节点增删改

| 方法 | 说明 |
| ---- | ---- |
| `addChild(parentId)` | 给指定节点添加子节点 |
| `addSibling(nodeId)` | 给指定节点添加同级 |
| `removeNode(nodeId)` | 删除节点及其子树 |
| `duplicateNode(nodeId)` | 复制一个节点(包含子树)并插入到同级 |
| `setNodeText(nodeId, text)` | 修改节点文字 |
| `moveNode(srcId, targetId, position)` | 移动节点;`position` = `'before'` / `'after'`(同级)或 `'child'`(成为 target 最后一个子节点)。返回 `true` 表示成功。 |

### 节点内容扩展

| 方法 | 说明 |
| ---- | ---- |
| `applyNodeStyle(nodeId, style)` | 覆盖指定节点的样式(`{ bg, textColor, borderColor, fontWeight }`)。传空对象 `{}` 清除。 |
| `getNodeStyle(nodeId)` | 读取指定节点的样式覆盖,无则返回 `{}`。 |
| `applyNodeLink(nodeId, url)` | 设置节点的超链接,空字符串清除。 |
| `removeNodeLink(nodeId)` | 删除节点的链接。 |
| `applyNodeNote(nodeId, text)` | 设置节点的笔记,空字符串清除。 |
| `removeNodeNote(nodeId)` | 删除节点的笔记。 |

### 视图

| 方法 | 说明 |
| ---- | ---- |
| `getData()` | 返回当前根节点(`MindMapNode`)。 |
| `setData(d)` | 用新的根节点替换数据。 |
| `resetView()` | 重置缩放/平移,让整棵树重新居中。 |
| `setBalanced(v)` / `isBalanced()` / `balance()` | 强制布局平衡模式(暂停/恢复/立即执行)。`autoBalanceOnChange` 设置项决定默认是否平衡。 |

### 撤销/重做

| 方法 | 说明 |
| ---- | ---- |
| `undo()` / `redo()` | 撤销 / 重做最近一次数据变更。 |
| `canUndo()` / `canRedo()` | 是否可撤销 / 重做。 |

### 导入/导出

| 方法 | 说明 |
| ---- | ---- |
| `exportData()` | 返回当前数据的 JSON 字符串。 |
| `importData(json)` | 从 JSON 字符串恢复数据,成功返回 `true`。 |
| `getMarkdown()` | 返回当前数据序列化后的 markdown 字符串。 |
| `setMarkdown(md, emitMarkdownChange?)` | 用 markdown 解析结果替换数据。`emitMarkdownChange` 默认 `true`,传 `false` 可避免回环(比如用 `markdown` prop 接收外部值后写回时)。 |

### 设置项

通过 [`MindMapSettings`](#数据类型) 控制画板、布局、连线、分支色板等行为。

| 方法 | 说明 |
| ---- | ---- |
| `applySettings(s)` | 部分更新设置,只覆盖传入的字段。 |
| `getSettings()` | 读取当前生效的设置。 |

### 调色板

| 方法 | 说明 |
| ---- | ---- |
| `setBranchPalette(id)` | 切换到指定色板;`id` 可以是内置(`'default'` / `'classic'` / `'vivid'` / `'dev'` / `'mint'`)或在 `settings.customPalettes` 注册过的自定义 id。未知 id 静默 no-op。 |
| `getBranchPalette()` | 读取当前色板 id。 |
| `getBranchPalettes()` | 读取所有色板(内置 + 自定义),用于渲染选择器。 |

### 连线宽度(高级)

| 方法 | 说明 |
| ---- | ---- |
| `lineWidthForDepth(depth)` | 深度 `depth` 节点出发的连线**父端**宽度(px)。 |
| `endWidthForDepth(depth)` | 深度 `depth` 节点出发的连线**子端**宽度(px)。 |

## 数据类型

```ts
import type {
  MindMapNode,
  MindMapImage,
  MindMapOptions,
  MindMapTheme,
  MindMapSettings,
  MindMapExpose,
  NodeStyle,
  LineStyle,
  LayoutMode,
  BranchPalette,
  BranchPaletteId,
} from 'flow-mindmap'
```

### `MindMapNode`

```ts
interface MindMapNode {
  id: string
  text: string
  children: MindMapNode[]
  collapsed?: boolean   // 初始折叠状态
  image?: MindMapImage  // 节点上方嵌入的图片
  link?: { url: string }// 节点超链接(图标点击跳转)
  note?: { text: string }// 节点笔记(图标悬浮预览、点击展开编辑)
  _x?: number           // 内部:拖拽后的位置覆盖(库内部使用,勿读勿写)
  _y?: number
}
```

### `MindMapImage`

```ts
interface MindMapImage {
  src: string           // 远程 URL 或 data URL
  naturalW: number      // 源图原始宽(用于锁定长宽比)
  naturalH: number      // 源图原始高
  width: number         // 当前渲染宽(用户可拖拽调整,24~400 px)
  height: number        // 当前渲染高
}
```

### `NodeStyle`

```ts
interface NodeStyle {
  bg?: string                       // 背景色
  textColor?: string                // 文字色
  borderColor?: string              // 边框色
  fontWeight?: 400 | 600            // 字重
}
```

### `MindMapSettings`

```ts
interface MindMapSettings {
  autoBalanceOnChange: boolean   // 增删/拖拽后自动回到平衡布局
  lineWidthStart: number         // 父端连线粗细
  lineWidthEnd: number           // 子端连线粗细
  rainbowBranch: boolean         // 顶层分支按色板循环配色
  branchPaletteId: string        // 当前色板 id
  customPalettes: BranchPalette[]// 用户自定义色板
  lineStyle: 'curve' | 'straight'// 连线形状:曲线(xmind 默认) / 直线
  layoutMode: 'mindmap' | 'tree' | 'org'  // 布局模式
  taperedEdge: boolean           // 锥形连线(每条独立锥化)
  showOrderBadge: boolean        // 节点上显示兄弟序号角标(调试用)
}
```

### `BranchPalette`

```ts
interface BranchPalette {
  id: string      // 唯一 id
  name: string    // 在选择器里显示的名字
  colors: string[]// 十六进制色值,按顺序循环
}
```

## 工具函数

```ts
import {
  uid,         // 生成不重复 id
  clone,       // 深克隆节点
  findNode,    // (root, id) => 节点
  findParent,  // (root, id) => 父节点
  removeNode,  // (root, id) => 移除子树
  addChild,    // (parent, text) => 新子节点
  addSibling,  // (node, text) => 新同级节点
  markdownToMindMap, // (md, rootText?) => MindMapNode — 与 MindMap 内部解析逻辑一致
  mindMapToMarkdown, // (node, depth?) => string — 与 MindMap 内部序列化逻辑一致
} from 'flow-mindmap'
```

## 全局组件

`app.use(FlowMindmap)` 会把组件注册为 `<FlowMindMap />`(驼峰式),所有 prop / event 与 `<MindMap>` 一致。

## 本地开发

```bash
pnpm install
pnpm dev      # http://localhost:7851  — 应用 demo
pnpm build    # 打包为 npm 库
```

## 协议

[Apache-2.0](./LICENSE) © xuze
