import { ref } from 'vue'
import type { MindMapNode } from '../types'

/**
 * Linear undo/redo history for the mind map.
 *
 * Each entry stores the data tree AND the per-node drag offsets that
 * the user accumulated up to that point.  The combination is what
 * determines the visual state, so the history needs to track both.
 *
 * The model:
 *   - `record(snapshot)` appends a NEW state to the timeline.  Call it
 *     AFTER applying a mutation (so the snapshot reflects the new
 *     state).  The cursor advances to the new state.
 *   - `undo()` returns the previous state, moving the cursor one step
 *     back.  Returns null if the cursor is already at the start.
 *   - `redo()` returns the next state, moving the cursor forward.
 *     Returns null if the cursor is already at the end.
 *   - `record` invalidates any "future" history past the cursor —
 *     like a text editor after a new edit, you can't redo over a
 *     branch.
 *
 * Snapshots are deep-cloned JSON strings (one string per state).  The
 * timeline is bounded so a long session doesn't grow without limit.
 */
export interface HistoryState {
  data: MindMapNode
  /** Per-node drag offsets, parallel to nodeDrag.nodeOffsets.
   *  Stored as a plain object so JSON round-trips cleanly. */
  offsets: Record<string, { x: number; y: number }>
}

export function useHistory(maxSize = 100) {
  const states = ref<string[]>([])
  let cursor = -1

  function canUndo() {
    return cursor > 0
  }
  function canRedo() {
    return cursor < states.value.length - 1
  }

  function record(snapshot: HistoryState) {
    const json = JSON.stringify(snapshot)
    if (cursor < states.value.length - 1) {
      states.value = states.value.slice(0, cursor + 1)
    }
    states.value.push(json)
    cursor = states.value.length - 1
    while (states.value.length > maxSize) {
      states.value.shift()
      cursor--
    }
  }

  function undo(): HistoryState | null {
    if (!canUndo()) return null
    cursor--
    return JSON.parse(states.value[cursor]) as HistoryState
  }

  function redo(): HistoryState | null {
    if (!canRedo()) return null
    cursor++
    return JSON.parse(states.value[cursor]) as HistoryState
  }

  function reset() {
    states.value = []
    cursor = -1
  }

  return {
    canUndo,
    canRedo,
    record,
    undo,
    redo,
    reset,
  }
}
