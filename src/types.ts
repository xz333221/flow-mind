export interface MindMapNode {
  id: string
  text: string
  children: MindMapNode[]
  collapsed?: boolean
  /**
   * Reserved for the layout algorithm — do not set or read from
   * your own code.  After a drag, MindMap writes the dragged
   * node's offset into the data tree so a subsequent layout with
   * `preservePositions: true` can keep the node where the user
   * put it.  Cleared on the next data-mutating action (add,
   * remove, edit, import) so unrelated re-layouts don't keep
   * stale overrides around.
   */
  _x?: number
  _y?: number
}

export interface MindMapOptions {
  data: MindMapNode
  readonly?: boolean
  theme?: MindMapTheme
}

export interface MindMapTheme {
  rootBg?: string
  rootText?: string
  branchBg?: string
  branchText?: string
  lineColor?: string
  bgColor?: string
  fontSize?: number
/** Stroke width of SVG connecting paths at the *parent-end* of the
   *  edge, in px.  Default 2.2. */
  lineWidthStart?: number
  /** Stroke width at the *child-end* of the edge, in px.  Default 0.8. */
  lineWidthEnd?: number
  /**
   * When true, each top-level branch gets its own color (root stays
   * neutral, every child[0] of root takes a different hue, and that
   * hue propagates down the subtree).  Default false.
   */
  rainbowBranch?: boolean
}

export type LineStyle = 'curve' | 'straight'
export type LayoutMode = 'mindmap' | 'tree' | 'org'

export interface MindMapSettings {
  /** When the user adds a new node or finishes a drag, automatically
   *  snap the layout back to balanced mode.  Default false. */
  autoBalanceOnChange: boolean
  /** Stroke width of SVG edges at the parent end. */
  lineWidthStart: number
  /** Stroke width of SVG edges at the child end. */
  lineWidthEnd: number
  /** Color-cycle the top-level branches. */
  rainbowBranch: boolean
  /** Edge shape between parent and child. 'curve' = fish-gill bezier
   *  (xmind default), 'straight' = direct line segment. */
  lineStyle: LineStyle
  /** Layout mode (1.html parity).  'mindmap' = center + left/right
   *  fans; 'tree' = single column expanding to the right; 'org' =
   *  downward hierarchy.  Default 'mindmap'. */
  layoutMode: LayoutMode
  /** When true (default), each edge tapers independently — its
   *  parent-end width comes from the parent node's tier and its
   *  child-end width comes from `lineWidthEnd`.  Visually you get
   *  discrete ribbons where the parent side of a level-2 edge can
   *  be thicker than the child side of a level-1 edge.
   *  When false, the whole tree forms a single tapered band:
   *  every edge's parent end = the previous edge's child end, so
   *  widths interpolate continuously from root to leaves. */
  taperedEdge: boolean
  /** When true, every node shows a small badge with its zero-based
   *  position in its parent's children array ("1.", "2.", "3.").
   *  Default false — useful when verifying the data-tree order
   *  against the visual layout. */
  showOrderBadge: boolean
}

export interface NodeStyle {
  bg?: string
  textColor?: string
  borderColor?: string
  fontWeight?: 400 | 600
}

export interface MindMapExpose {
  addChild: (parentId: string) => void
  addSibling: (nodeId: string) => void
  removeNode: (nodeId: string) => void
  duplicateNode: (nodeId: string) => void
  /** Set a node's text (no-op if unchanged).  Used by the outline
   *  panel's inline edit; the canvas has its own dblclick → input
   *  flow. */
  setNodeText: (nodeId: string, text: string) => void
  /** Move a node to a new location.  `position` is relative to
   *  `targetId`: 'before' / 'after' insert as siblings, 'child'
   *  makes it the last child of target.  Used by the outline panel's
   *  drag-and-drop.  Returns true on success, false (no-op) if the
   *  move would create a cycle or hit another invalid case. */
  moveNode: (srcId: string, targetId: string, position: 'before' | 'after' | 'child') => boolean
  getData: () => MindMapNode
  setData: (data: MindMapNode) => void
  resetView: () => void
  exportData: () => string
  importData: (json: string) => boolean
  setBalanced: (value: boolean) => void
  isBalanced: () => boolean
  balance: () => void
  /** Apply or update the per-node style override (empty object clears it). */
  applyNodeStyle: (nodeId: string, style: NodeStyle) => void
  /** Read the current per-node style override. */
  getNodeStyle: (nodeId: string) => NodeStyle
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  /** Apply a partial settings object — keys you omit are left as-is. */
  applySettings: (s: Partial<MindMapSettings>) => void
  /** Read the current effective settings. */
  getSettings: () => MindMapSettings
  /** Stroke width used for the parent end of an edge that starts at
   *  a node of the given depth. Lets the canvas taper sharply
   *  (root → 1st → 2nd → 3rd+) instead of using a single global
   *  width. */
  lineWidthForDepth: (depth: number) => number
  /** Stroke width used for the child end of an edge that ends at
   *  a node of the given depth. */
  endWidthForDepth: (depth: number) => number
}
