<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { MindMapSettings, LineStyle, BranchPalette } from '../types'
import { BUILTIN_PALETTES, parsePaletteInput } from '../core/palettes'

const props = defineProps<{
  settings: MindMapSettings
  /** true when a node is selected — the per-node panel is shown too. */
  hasSelection: boolean
  selectedNodeText?: string
}>()

const emit = defineEmits<{
  (e: 'update:settings', s: Partial<MindMapSettings>): void
  (e: 'update:nodeStyle', s: Partial<NodeStyle>): void
  (e: 'reset'): void
}>()

/** Style overrides for a single node.  Stored externally (App.vue
 *  holds the map) so the per-node state is preserved across
 *  selection changes. */
export interface NodeStyle {
  /** Background colour.  undefined = fall back to theme/branch. */
  bg?: string
  /** Text colour. */
  textColor?: string
  /** Border colour. */
  borderColor?: string
  /** Font weight: 400 / 600.  undefined = inherit. */
  fontWeight?: 400 | 600
}

function set<K extends keyof MindMapSettings>(key: K, value: MindMapSettings[K]) {
  emit('update:settings', { [key]: value })
}

const startLabel = computed(() => {
  // Kept for backward compat with anything still subscribing; the
  // settings row no longer shows the qualitative label, it shows
  // an editable number input.
  const w = props.settings.lineWidthStart
  if (w < 1.2) return '细'
  if (w < 2.5) return '中'
  if (w < 4) return '粗'
  return '极粗'
})

const endLabel = computed(() => {
  const w = props.settings.lineWidthEnd
  if (w < 0.6) return '极细'
  if (w < 1.2) return '细'
  if (w < 2.0) return '中'
  return '粗'
})

/** Line style picker options. The icon shows the line shape; the
 *  label is the Chinese name. */
const LINE_STYLE_OPTIONS: { value: LineStyle; label: string; viewBox: string }[] = [
  { value: 'curve', label: '圆弧', viewBox: '0 0 28 14' },
  { value: 'straight', label: '直线', viewBox: '0 0 28 14' },
]

// local node-style form state — not bound to props; user types here,
// then "应用" commits via emit.  This keeps the panel simple while
// still letting the user preview their choice in the swatch.
const localStyle = reactive<NodeStyle>({ fontWeight: 400 })

function applyStyle() {
  emit('update:nodeStyle', { ...localStyle })
}

function resetStyle() {
  localStyle.bg = undefined
  localStyle.textColor = undefined
  localStyle.borderColor = undefined
  localStyle.fontWeight = 400
  emit('update:nodeStyle', { ...localStyle })
}

// =====================================================================
// Palette picker
// =====================================================================
//
// All palettes (built-in + user-defined custom) — fed by
// `props.settings.customPalettes` and the BUILTIN_PALETTES export.
// The active palette id is `props.settings.branchPaletteId`.  This
// view is purely derived; mutations are sent back through the
// existing `update:settings` emit so the parent (App.vue) can
// persist and re-feed via `applySettings` — same round-trip the
// other settings use.

// Editable textarea mirror for each custom palette.  Keyed by
// palette id so the input survives across re-renders.  We hold the
// text separately from the canonical `colors` array so the user
// can paste-then-tweak-then-commit without the canvas live-rendering
// malformed hex strings.
const customDrafts = reactive<Record<string, string>>({})

function draftFor(p: BranchPalette): string {
  if (customDrafts[p.id] === undefined) {
    customDrafts[p.id] = p.colors.join('\n')
  }
  return customDrafts[p.id]
}

function commitCustomPalette(p: BranchPalette) {
  const draft = customDrafts[p.id] ?? ''
  const colors = parsePaletteInput(draft)
  if (colors.length === 0) {
    // Reject the empty save — restore the draft to the palette's
    // current colors so the user sees a working state and can fix.
    customDrafts[p.id] = p.colors.join('\n')
    return
  }
  const next = props.settings.customPalettes.map((q) =>
    q.id === p.id ? { ...q, colors } : q
  )
  emit('update:settings', { customPalettes: next })
}

function addCustomPalette() {
  // Seed the new palette from the currently active scheme so it
  // visually matches what the user has on canvas right now.
  const active = allPalettes.value.find(
    (p) => p.id === props.settings.branchPaletteId
  )
  const seed = active ? [...active.colors] : [...BUILTIN_PALETTES[0].colors]
  // Avoid id collisions with built-ins or existing customs.
  const baseId = 'custom-'
  let id = baseId + (props.settings.customPalettes.length + 1)
  while (
    BUILTIN_PALETTES.some((p) => p.id === id) ||
    props.settings.customPalettes.some((p) => p.id === id)
  ) {
    id = baseId + Math.random().toString(36).slice(2, 7)
  }
  const palette: BranchPalette = {
    id,
    name: `我的配色 ${props.settings.customPalettes.length + 1}`,
    colors: seed,
  }
  emit('update:settings', {
    customPalettes: [...props.settings.customPalettes, palette],
    branchPaletteId: id,
  })
  // Pre-fill the draft with the seed so the textarea isn't empty.
  customDrafts[id] = seed.join('\n')
}

function deleteCustomPalette(p: BranchPalette) {
  const next = props.settings.customPalettes.filter((q) => q.id !== p.id)
  // If the deleted palette was active, fall back to 'default'.
  const active = props.settings.branchPaletteId === p.id
    ? 'default'
    : props.settings.branchPaletteId
  emit('update:settings', {
    customPalettes: next,
    ...(active !== props.settings.branchPaletteId ? { branchPaletteId: active } : {}),
  })
  delete customDrafts[p.id]
}

const allPalettes = computed<BranchPalette[]>(() => [
  ...BUILTIN_PALETTES,
  ...props.settings.customPalettes,
])

// simple preset palette for the swatch buttons
const PALETTE = ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#22d3ee', '#818cf8', '#c084fc', '#1e2937', '#f8fafc', '#94a3b8']

/** Build a tiny 4-line preview that mirrors the canvas taper.
 *  The shape depends on `taperedEdge`:
 *  - taperedEdge = true (default): each line is a discrete ribbon
 *    (parent-side width depends on tier, child side is `lineWidthEnd`).
 *    The lines look independent, like the canvas.
 *  - taperedEdge = false: widths interpolate continuously from
 *    `lineWidthStart` (root) to `lineWidthEnd` (leaf), so all four
 *    lines form a single tapered band.
 *  In both modes, `lineWidthStart` is the absolute width of the
 *  parent end of the first line so the user can see what they're
 *  dialing.  The preview lives at the top of the popover. */
const PREVIEW_DEPTHS = [0, 1, 2, 3] as const
// Preview swatch colors are sourced from the active palette when
// rainbow is on (so the user sees the scheme they're committing
// to) and from the line color otherwise.
const PREVIEW_PALETTE = ['#f87171', '#fb923c', '#34d399', '#818cf8']
function widthAt(depth: number, total: number, start: number, end: number): number {
  if (total <= 1) return start
  const t = depth / (total - 1)
  return start + (end - start) * t
}
function taperedParentW(depth: number, start: number, end: number): number {
  if (depth <= 0) return start
  if (depth === 1) return Math.max(1.5, start * 0.67)
  if (depth === 2) return Math.max(0.8, start * 0.42)
  return end
}
const previewLines = computed(() => {
  const start = props.settings.lineWidthStart
  const end = props.settings.lineWidthEnd
  const tapered = props.settings.taperedEdge
  const total = PREVIEW_DEPTHS.length
  const left = 8
  const right = 192
  // When the user has rainbow on, sample the active palette so the
  // preview line tint tracks the selected scheme.
  const active = allPalettes.value.find(
    (p) => p.id === props.settings.branchPaletteId
  )
  const colors = active && active.colors.length
    ? active.colors
    : PREVIEW_PALETTE
  return PREVIEW_DEPTHS.map((d, i) => {
    const y = 10 + (i * 60) / (total - 1)
    return {
      x1: left,
      y1: y,
      x2: right,
      y2: y,
      // Render the FULL width as a fat stroke so the user sees the
      // band, not just a thin centerline.
      w: tapered ? taperedParentW(d, start, end) : widthAt(d, total, start, end),
      color: props.settings.rainbowBranch
        ? colors[i % colors.length]
        : '#94a3b8',
    }
  })
})
</script>

<template>
  <div class="zm-settings-panel">
    <!-- ============================================================
         CANVAS / GLOBAL settings — visible when no node is selected
         ============================================================ -->
    <section v-if="!hasSelection" class="zm-settings-section">
      <h4 class="zm-settings-section-title">画布</h4>

      <div class="zm-settings-row">
        <span class="zm-settings-label">线条粗端(根部)</span>
        <input
          class="zm-settings-number"
          type="number"
          step="0.2"
          :value="settings.lineWidthStart"
          @change="(e) => set('lineWidthStart', parseFloat((e.target as HTMLInputElement).value) || 0)"
        />
      </div>
      <div class="zm-slider">
        <input
          type="range"
          min="0.4"
          max="20"
          step="0.2"
          :value="settings.lineWidthStart"
          @input="(e) => set('lineWidthStart', parseFloat((e.target as HTMLInputElement).value))"
        />
      </div>

      <div class="zm-settings-row">
        <span class="zm-settings-label">线条细端(子端)</span>
        <input
          class="zm-settings-number"
          type="number"
          step="0.2"
          :value="settings.lineWidthEnd"
          @change="(e) => set('lineWidthEnd', parseFloat((e.target as HTMLInputElement).value) || 0)"
        />
      </div>
      <div class="zm-slider">
        <input
          type="range"
          min="0.2"
          max="6"
          step="0.1"
          :value="settings.lineWidthEnd"
          @input="(e) => set('lineWidthEnd', parseFloat((e.target as HTMLInputElement).value))"
        />
      </div>

      <div class="zm-settings-row">
        <span class="zm-settings-label">线条类型</span>
        <div class="zm-line-style-group">
          <button
            v-for="opt in LINE_STYLE_OPTIONS"
            :key="opt.value"
            class="zm-line-style-btn"
            :class="{ 'is-on': settings.lineStyle === opt.value }"
            :title="opt.label"
            @click="set('lineStyle', opt.value)"
          >
            <svg :viewBox="opt.viewBox" width="28" height="14" preserveAspectRatio="none">
              <path
                v-if="opt.value === 'curve'"
                d="M 0 12 C 8 0, 20 0, 28 12"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
              />
              <line
                v-else
                x1="0" y1="12" x2="28" y2="12"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
              />
            </svg>
            <span class="zm-line-style-label">{{ opt.label }}</span>
          </button>
        </div>
      </div>

      <label class="zm-settings-row">
        <span class="zm-settings-label">一级分支彩虹色</span>
        <button
          class="zm-toggle"
          :class="{ 'is-on': settings.rainbowBranch }"
          @click="set('rainbowBranch', !settings.rainbowBranch)"
        >
          <span class="zm-toggle-knob" />
        </button>
      </label>
      <p class="zm-settings-hint">关闭时所有线条使用统一的 lineColor。</p>

      <div v-if="settings.rainbowBranch" class="zm-palette-picker">
        <h5 class="zm-palette-picker-title">配色方案</h5>

        <!-- Built-in palettes — the user picks one by clicking the
             card.  Active card gets a highlighted border. -->
        <div class="zm-palette-grid">
          <button
            v-for="p in BUILTIN_PALETTES"
            :key="p.id"
            type="button"
            class="zm-palette-card"
            :class="{ 'is-active': settings.branchPaletteId === p.id }"
            :title="p.name"
            @click="set('branchPaletteId', p.id)"
          >
            <span class="zm-palette-card-name">{{ p.name }}</span>
            <span class="zm-palette-card-swatches">
              <span
                v-for="(c, i) in p.colors"
                :key="i"
                class="zm-palette-card-swatch"
                :style="{ background: c }"
              />
            </span>
          </button>
        </div>

        <!-- Custom palettes — same clickable card, plus an inline
             textarea for editing colors.  Save commits; the canvas
             doesn't re-render until the user clicks "保存", so a
             half-typed color string doesn't paint garbage. -->
        <div v-if="settings.customPalettes.length" class="zm-palette-customs">
          <div
            v-for="p in settings.customPalettes"
            :key="p.id"
            class="zm-palette-custom"
          >
            <button
              type="button"
              class="zm-palette-card"
              :class="{ 'is-active': settings.branchPaletteId === p.id }"
              :title="p.name"
              @click="set('branchPaletteId', p.id)"
            >
              <span class="zm-palette-card-name">{{ p.name }}</span>
              <span class="zm-palette-card-swatches">
                <span
                  v-for="(c, i) in p.colors"
                  :key="i"
                  class="zm-palette-card-swatch"
                  :style="{ background: c }"
                />
              </span>
            </button>
            <textarea
              class="zm-palette-textarea"
              rows="2"
              spellcheck="false"
              placeholder="一行一个 hex,例如 #f87171"
              :value="draftFor(p)"
              @input="(e) => (customDrafts[p.id] = (e.target as HTMLTextAreaElement).value)"
            />
            <div class="zm-palette-custom-actions">
              <button
                type="button"
                class="zm-data-btn is-primary"
                @click="commitCustomPalette(p)"
              >保存</button>
              <button
                type="button"
                class="zm-data-btn"
                @click="deleteCustomPalette(p)"
              >删除</button>
            </div>
          </div>
        </div>

        <button
          type="button"
          class="zm-palette-add"
          @click="addCustomPalette"
        >+ 新建配色</button>
      </div>

      <label class="zm-settings-row">
        <span class="zm-settings-label">每条连线独立渐变</span>
        <button
          class="zm-toggle"
          :class="{ 'is-on': settings.taperedEdge }"
          @click="set('taperedEdge', !settings.taperedEdge)"
        >
          <span class="zm-toggle-knob" />
        </button>
      </label>
      <p class="zm-settings-hint">
        开启时每条边都从根部粗端收回到细端子端,父子边之间可能形成粗细跳变;
        关闭时整棵树从最粗平滑过渡到最细,所有边连成一条带子。
      </p>

      <label class="zm-settings-row">
        <span class="zm-settings-label">显示节点序号</span>
        <button
          class="zm-toggle"
          :class="{ 'is-on': settings.showOrderBadge }"
          @click="set('showOrderBadge', !settings.showOrderBadge)"
        >
          <span class="zm-toggle-knob" />
        </button>
      </label>
      <p class="zm-settings-hint">
        在每个节点右上角标注它是同级中的第几个 (1, 2, 3, ...),
        方便对比画布位置与数据顺序。
      </p>

      <div class="zm-settings-preview">
        <svg viewBox="0 0 200 70" width="100%" height="70" preserveAspectRatio="none">
          <line
            v-for="(seg, i) in previewLines"
            :key="i"
            :x1="seg.x1" :y1="seg.y1" :x2="seg.x2" :y2="seg.y2"
            :stroke="settings.rainbowBranch ? seg.color : '#94a3b8'"
            :stroke-width="seg.w"
            stroke-linecap="butt"
          />
        </svg>
        <div class="zm-settings-preview-labels">
          <span>根</span>
          <span>1级</span>
          <span>2级</span>
          <span>3级</span>
        </div>
      </div>
    </section>

    <!-- ============================================================
         CANVAS / GLOBAL settings — read-only summary when a node is
         selected.  Users can still see and tweak the canvas-level
         rules from here; the node style section is appended below.
         ============================================================ -->
    <section v-else class="zm-settings-section">
      <h4 class="zm-settings-section-title">画布</h4>
      <div class="zm-settings-row">
        <span class="zm-settings-label">线条粗端</span>
        <span class="zm-settings-value-tag">{{ settings.lineWidthStart.toFixed(1) }}</span>
      </div>
      <div class="zm-settings-row">
        <span class="zm-settings-label">线条细端</span>
        <span class="zm-settings-value-tag">{{ settings.lineWidthEnd.toFixed(1) }}</span>
      </div>
      <div class="zm-settings-row">
        <span class="zm-settings-label">线条类型</span>
        <span class="zm-settings-value-tag">{{ settings.lineStyle === 'curve' ? '圆弧' : '直线' }}</span>
      </div>
      <label class="zm-settings-row">
        <span class="zm-settings-label">一级分支彩虹色</span>
        <button
          class="zm-toggle"
          :class="{ 'is-on': settings.rainbowBranch }"
          @click="set('rainbowBranch', !settings.rainbowBranch)"
        >
          <span class="zm-toggle-knob" />
        </button>
      </label>
      <p class="zm-settings-hint">画布级别的设置会影响整张图。</p>
    </section>

    <!-- ============================================================
         NODE-LEVEL overrides — only when a node is selected.
         These DO NOT propagate down the subtree; the per-node style
         applies to just this node so children keep the canvas theme.
         ============================================================ -->
    <section v-if="hasSelection" class="zm-settings-section">
      <h4 class="zm-settings-section-title">
        节点
        <span v-if="selectedNodeText" class="zm-settings-section-sub">“{{ selectedNodeText }}”</span>
      </h4>

      <div class="zm-settings-row">
        <span class="zm-settings-label">背景颜色</span>
        <span class="zm-settings-value-tag">{{ localStyle.bg || '默认' }}</span>
      </div>
      <div class="zm-swatch-row">
        <button
          v-for="c in PALETTE"
          :key="'bg-' + c"
          class="zm-swatch"
          :style="{ background: c }"
          :title="c"
          @click="localStyle.bg = c"
        />
        <button class="zm-swatch is-reset" title="清除" @click="localStyle.bg = undefined">∅</button>
      </div>

      <div class="zm-settings-row">
        <span class="zm-settings-label">文字颜色</span>
        <span class="zm-settings-value-tag">{{ localStyle.textColor || '默认' }}</span>
      </div>
      <div class="zm-swatch-row">
        <button
          v-for="c in PALETTE"
          :key="'fg-' + c"
          class="zm-swatch"
          :style="{ background: c }"
          :title="c"
          @click="localStyle.textColor = c"
        />
        <button class="zm-swatch is-reset" title="清除" @click="localStyle.textColor = undefined">∅</button>
      </div>

      <div class="zm-settings-row">
        <span class="zm-settings-label">字重</span>
        <button
          class="zm-toggle"
          :class="{ 'is-on': localStyle.fontWeight === 600 }"
          @click="localStyle.fontWeight = localStyle.fontWeight === 600 ? 400 : 600"
        >
          <span class="zm-toggle-knob" />
        </button>
      </div>

      <div class="zm-data-paste-actions">
        <button class="zm-data-btn is-primary" @click="applyStyle">应用到该节点</button>
        <button class="zm-data-btn" @click="resetStyle">清除该节点样式</button>
      </div>
      <p class="zm-settings-hint">仅作用于当前节点,不影响子节点。</p>
    </section>

    <section class="zm-settings-section">
      <button class="zm-settings-reset" @click="emit('reset')">恢复默认设置</button>
    </section>
  </div>
</template>

<style scoped>
.zm-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px 12px 16px;
}
.zm-settings-section {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
}
.zm-settings-section-title {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.zm-settings-section-sub {
  font-size: 11px;
  font-weight: 500;
  color: #64748b;
  text-transform: none;
  letter-spacing: 0;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zm-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 6px 0;
  font-size: 13px;
  color: #1e293b;
}
.zm-settings-label {
  flex: 1;
}
.zm-settings-value-tag {
  font-size: 11px;
  color: #64748b;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 2px 6px;
  white-space: nowrap;
}
.zm-settings-number {
  font-size: 11px;
  color: #0f172a;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 2px 6px;
  width: 56px;
  text-align: right;
  -moz-appearance: textfield;
}
.zm-settings-number::-webkit-outer-spin-button,
.zm-settings-number::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.zm-settings-number:focus {
  outline: none;
  border-color: #818cf8;
}
.zm-settings-hint {
  margin: 4px 0 0;
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.5;
}
.zm-slider {
  position: relative;
  height: 20px;
  display: flex;
  align-items: center;
  margin: 4px 0 8px;
}
.zm-slider-track {
  position: absolute;
  inset: 8px 0;
  background: #e2e8f0;
  border-radius: 999px;
  pointer-events: none;
}
.zm-slider input[type='range'] {
  position: relative;
  width: 100%;
  margin: 0;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  height: 20px;
  cursor: pointer;
  z-index: 1;
}
.zm-slider input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  border: 2px solid #3b82f6;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  cursor: pointer;
}
.zm-slider input[type='range']::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  border: 2px solid #3b82f6;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  cursor: pointer;
}
.zm-toggle {
  position: relative;
  width: 36px;
  height: 20px;
  border: none;
  background: #cbd5e1;
  border-radius: 999px;
  padding: 0;
  cursor: pointer;
  transition: background 0.15s;
  flex-shrink: 0;
}
.zm-toggle.is-on {
  background: #3b82f6;
}
.zm-toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #ffffff;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  transition: transform 0.15s;
}
.zm-toggle.is-on .zm-toggle-knob {
  transform: translateX(16px);
}
.zm-swatch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 4px 0 8px;
}
.zm-swatch {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}
.zm-swatch.is-reset {
  background: #ffffff;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1;
}
.zm-line-style-group {
  display: flex;
  gap: 6px;
}
.zm-line-style-btn {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  color: #94a3b8;
  transition: all 0.12s;
  font-family: inherit;
  min-width: 56px;
}
.zm-line-style-btn:hover {
  border-color: #cbd5e1;
  color: #475569;
}
.zm-line-style-btn.is-on {
  border-color: #3b82f6;
  background: #eff6ff;
  color: #3b82f6;
}
.zm-line-style-label {
  font-size: 11px;
  font-weight: 500;
}
.zm-settings-preview {
  margin-top: 8px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 6px 6px 4px;
}
.zm-settings-preview svg {
  display: block;
}
.zm-settings-preview-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #94a3b8;
  margin-top: 2px;
  padding: 0 2px;
}
.zm-data-paste-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.zm-data-btn {
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
}
.zm-data-btn:hover {
  background: #f1f5f9;
  color: #1e293b;
  border-color: #cbd5e1;
}
.zm-data-btn.is-primary {
  background: #3b82f6;
  color: #ffffff;
  border-color: #3b82f6;
}
.zm-data-btn.is-primary:hover {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
}
.zm-settings-reset {
  width: 100%;
  padding: 6px 10px;
  font-size: 12px;
  font-family: inherit;
  color: #475569;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.1s;
}
.zm-settings-reset:hover {
  background: #f1f5f9;
  color: #1e293b;
}

/* =====================================================================
   Palette picker
   ===================================================================== */

.zm-palette-picker {
  margin: 6px 0 8px;
}
.zm-palette-picker-title {
  margin: 6px 0 6px;
  font-size: 11px;
  font-weight: 600;
  color: #475569;
  letter-spacing: 0.02em;
}
.zm-palette-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 6px;
}
.zm-palette-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 6px 6px 8px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: all 0.12s;
  min-width: 0;
}
.zm-palette-card:hover {
  border-color: #cbd5e1;
  background: #f8fafc;
}
.zm-palette-card.is-active {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.18);
  background: #eff6ff;
}
.zm-palette-card-name {
  font-size: 11px;
  font-weight: 500;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.zm-palette-card.is-active .zm-palette-card-name {
  color: #1d4ed8;
}
.zm-palette-card-swatches {
  display: flex;
  gap: 1px;
  height: 8px;
  border-radius: 3px;
  overflow: hidden;
}
.zm-palette-card-swatch {
  flex: 1;
  height: 100%;
  min-width: 0;
}
.zm-palette-customs {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.zm-palette-custom {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.zm-palette-custom .zm-palette-card {
  border-style: dashed;
  background: #f8fafc;
}
.zm-palette-textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: #0f172a;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 4px 6px;
  resize: vertical;
  min-height: 32px;
  outline: none;
  transition: border-color 0.1s;
}
.zm-palette-textarea:focus {
  border-color: #3b82f6;
  background: #ffffff;
}
.zm-palette-custom-actions {
  display: flex;
  gap: 6px;
}
.zm-palette-add {
  margin-top: 8px;
  width: 100%;
  padding: 6px 8px;
  font-size: 12px;
  font-family: inherit;
  color: #475569;
  background: #ffffff;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.1s;
}
.zm-palette-add:hover {
  background: #f1f5f9;
  color: #1e293b;
  border-color: #94a3b8;
}
</style>
