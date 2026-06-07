import MindMap from './components/MindMap.vue'
import type { App } from 'vue'
import type { MindMapNode, MindMapOptions, MindMapTheme, MindMapExpose } from './types'
import { uid, clone, findNode, findParent, removeNode, addChild, addSibling } from './tree'

export type { MindMapNode, MindMapOptions, MindMapTheme, MindMapExpose }
export { MindMap }
export { uid, clone, findNode, findParent, removeNode, addChild, addSibling }

const plugin = {
  install(app: App) {
    app.component('FlowMindMap', MindMap)
  },
}

export default plugin
