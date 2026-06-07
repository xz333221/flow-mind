import { ref, reactive, type Ref } from 'vue'
import type { LayoutNode } from '../core/layout'

export interface NodeDragOptions {
  scale: Ref<number>
  getNodeById: (id: string) => LayoutNode | undefined
  collectDescendants: (id: string) => string[]
  /** Called once on mousedown (with the pre-drag offset map) and
   *  once on mouseup (with the post-drag offset map).  The caller
   *  can use this to push history snapshots so drag is undoable. */
  onChange?: () => void
}

export function useNodeDrag(opts: NodeDragOptions) {
  const draggingNodeId: Ref<string | null> = ref(null)
  const dragStart = reactive<{ x: number; y: number; sx: number; sy: number }>({
    x: 0,
    y: 0,
    sx: 0,
    sy: 0,
  })
  const dragDelta = ref<{ x: number; y: number } | null>(null)
  // committed per-node offsets (layout coords) — must outlive the drag and be passed in
  const nodeOffsets = reactive(new Map<string, { x: number; y: number }>())

  function getOffset(id: string): { x: number; y: number } {
    return nodeOffsets.get(id) ?? { x: 0, y: 0 }
  }

  /** Layout-space (un-scaled) position of `n` — used by `left`/`top`
   *  and by the SVG edge anchor.  Includes both the committed
   *  per-node drag offset AND the in-flight dragDelta when this
   *  node is being dragged — so the SVG edges track the node
   *  1:1 as the user moves it.  (Earlier versions left the
   *  in-flight delta out and applied it via CSS transform on the
   *  node, which made the node glide under the cursor but left
   *  the edges behind until mouseup.) */
  function nodePos(n: LayoutNode): { x: number; y: number } {
    const off = getOffset(n.id)
    const live = liveDragDelta(n.id)
    return { x: n.x + off.x + live.x, y: n.y + off.y + live.y }
  }

  /** Live drag delta in layout space — only non-null while the user
   *  is mid-drag.  Use this for the node's CSS `transform` so the
   *  node glides under the cursor without the SVG edges (which use
   *  `nodePos`) drifting relative to it.  Returns 0/0 when not
   *  dragging, so the transform is a no-op for un-dragged nodes. */
  function liveDragDelta(id: string): { x: number; y: number } {
    if (draggingNodeId.value === id && dragDelta.value) {
      return { x: dragDelta.value.x, y: dragDelta.value.y }
    }
    return { x: 0, y: 0 }
  }

  function startNodeDrag(e: MouseEvent, n: LayoutNode, readonly: boolean) {
    if (readonly) return
    e.stopPropagation()
    draggingNodeId.value = n.id
    dragStart.x = e.clientX
    dragStart.y = e.clientY
    dragStart.sx = n.x
    dragStart.sy = n.y
    dragDelta.value = { x: 0, y: 0 }
    window.addEventListener('mousemove', onNodeDragMove)
    window.addEventListener('mouseup', onNodeDragEnd)
    // Snapshot the pre-drag state so a subsequent undo can restore it.
    opts.onChange?.()
  }

  function onNodeDragMove(e: MouseEvent) {
    if (!draggingNodeId.value) return
    const scaleFix = 1 / opts.scale.value
    dragDelta.value = {
      x: (e.clientX - dragStart.x) * scaleFix,
      y: (e.clientY - dragStart.y) * scaleFix,
    }
  }

  function onNodeDragEnd() {
    if (draggingNodeId.value && dragDelta.value) {
      const id = draggingNodeId.value
      const dx = dragDelta.value.x
      const dy = dragDelta.value.y
      // A plain click (mousedown → mouseup with no movement) lands
      // here with dx/dy = 0.  Skip the commit/onChange — otherwise
      // the caller's onChange runs resetView() on every node
      // click and yanks the user's zoom back to fit.
      if (dx !== 0 || dy !== 0) {
        const off = nodeOffsets.get(id) ?? { x: 0, y: 0 }
        nodeOffsets.set(id, { x: off.x + dx, y: off.y + dy })
        const ids = opts.collectDescendants(id)
        for (const cid of ids) {
          const c = nodeOffsets.get(cid) ?? { x: 0, y: 0 }
          nodeOffsets.set(cid, { x: c.x + dx, y: c.y + dy })
        }
        opts.onChange?.()
      }
    }
    draggingNodeId.value = null
    window.removeEventListener('mousemove', onNodeDragMove)
    window.removeEventListener('mouseup', onNodeDragEnd)
    dragDelta.value = null
  }

  function resetOffsets() {
    nodeOffsets.clear()
  }

  /** Bulk-load offsets from a snapshot — used by history.undo() to
   *  restore the offset map the user had before a drag. */
  function setOffsets(offsets: Map<string, { x: number; y: number }> | Record<string, { x: number; y: number }>) {
    nodeOffsets.clear()
    if (offsets instanceof Map) {
      for (const [k, v] of offsets) nodeOffsets.set(k, v)
    } else {
      for (const k in offsets) nodeOffsets.set(k, offsets[k])
    }
  }

  function getOffsets(): Record<string, { x: number; y: number }> {
    const out: Record<string, { x: number; y: number }> = {}
    for (const [k, v] of nodeOffsets) out[k] = { x: v.x, y: v.y }
    return out
  }

  return {
    draggingNodeId,
    dragDelta,
    nodeOffsets,
    getOffset,
    getOffsets,
    setOffsets,
    nodePos,
    liveDragDelta,
    startNodeDrag,
    resetOffsets,
  }
}
