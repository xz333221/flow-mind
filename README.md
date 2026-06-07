# flow-mind

A modern, minimalist mind mapping tool — xmind-style, embeddable as a Vue 3 component.

- 纯 SVG 渲染,矢量缩放无损
- 拖拽、缩放、平移画布
- 键盘快捷键: `Tab` 添加子节点 / `Enter` 添加同级 / `F2` 编辑 / `Delete` 删除节点
- 一键折叠/展开子树
- 扁平化 SVG 线框图标,无任何 Emoji
- Apache-2.0 开源协议,可在 npm 安装作为组件使用

## 安装

```bash
pnpm add flow-mind
```

## 在项目中使用

```ts
import { createApp } from 'vue'
import FlowMind from 'flow-mind'
import 'flow-mind/style.css'

const app = createApp(App)
app.use(FlowMind)
```

或局部使用:

```vue
<script setup lang="ts">
import { MindMap } from 'flow-mind'
import type { MindMapNode } from 'flow-mind'

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
  <div style="width: 100vw; height: 100vh">
    <MindMap :data="data" />
  </div>
</template>
```

## API

| Prop | Type | Default | 说明 |
| ---- | ---- | ------- | ---- |
| `data` | `MindMapNode` | — | 思维导图根节点 |
| `readonly` | `boolean` | `false` | 是否只读 |
| `theme` | `MindMapTheme` | — | 主题色配置 |

`MindMap` 实例方法(通过 `ref` 访问):

- `addChild(parentId)` — 给指定节点添加子节点
- `addSibling(nodeId)` — 给指定节点添加同级
- `removeNode(nodeId)` — 删除节点
- `getData()` / `setData(d)` — 读写数据
- `resetView()` — 重置缩放与位置

## 本地开发

```bash
pnpm install
pnpm dev      # http://localhost:7851
pnpm build    # 打包为 npm 库
```

## 协议

[Apache-2.0](./LICENSE) © xuze
