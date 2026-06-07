import MindMap from './components/MindMap.vue'
import type { App } from 'vue'
import type { MindMapNode, MindMapOptions, MindMapTheme, MindMapExpose, MindMapSettings, NodeStyle, LineStyle, LayoutMode, BranchPalette, BranchPaletteId } from './types'
import { uid, clone, findNode, findParent, removeNode, addChild, addSibling, markdownToMindMap, mindMapToMarkdown } from './tree'

export type { MindMapNode, MindMapOptions, MindMapTheme, MindMapExpose, MindMapSettings, NodeStyle, LineStyle, LayoutMode, BranchPalette, BranchPaletteId }
export { MindMap }
export { uid, clone, findNode, findParent, removeNode, addChild, addSibling, markdownToMindMap, mindMapToMarkdown }

const plugin = {
  install(app: App) {
    app.component('FlowMindMap', MindMap)
  },
}

export default plugin
