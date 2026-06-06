<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { MindMapSettings, LineStyle } from '../types'

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

// simple preset palette for the swatch buttons
const PALETTE = ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#22d3ee', '#818cf8', '#c084fc', '#1e2937', '#f8fafc', '#94a3b8']

/** Build a tiny 4-line preview that mirrors the canvas taper:
 *  line 0 (root → level-1) uses `lineWidthStart`; line 3 (level-3
 *  leaf) uses `lineWidthEnd`; intermediate levels interpolate.  The
 *  preview lives at the top of the popover so the user can see the
 *  effect of the two sliders before they commit. */
const PREVIEW_DEPTHS = [0, 1, 2, 3] as const
const PREVIEW_PALETTE = ['#f87171', '#fb923c', '#34d399', '#818cf8']
function widthAt(depth: number, total: number, start: number, end: number): number {
  if (total <= 1) return start
  const t = depth / (total - 1)
  return start + (end - start) * t
}
const previewLines = computed(() => {
  const start = props.settings.lineWidthStart
  const end = props.settings.lineWidthEnd
  const total = PREVIEW_DEPTHS.length
  const left = 8
  const right = 192
  const yMid = 35
  return PREVIEW_DEPTHS.map((d, i) => {
    const y = 10 + (i * 60) / (total - 1)
    return {
      x1: left,
      y1: y,
      x2: right,
      y2: y,
      w: widthAt(d, total, start, end),
      color: PREVIEW_PALETTE[i % PREVIEW_PALETTE.length],
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

      <label class="zm-settings-row">
        <span class="zm-settings-label">添加/拖动后自动平衡</span>
        <button
          class="zm-toggle"
          :class="{ 'is-on': settings.autoBalanceOnChange }"
          @click="set('autoBalanceOnChange', !settings.autoBalanceOnChange)"
        >
          <span class="zm-toggle-knob" />
        </button>
      </label>

      <div class="zm-settings-row">
        <span class="zm-settings-label">线条粗端(根部)</span>
        <span class="zm-settings-value-tag">{{ startLabel }} ({{ settings.lineWidthStart.toFixed(1) }})</span>
      </div>
      <div class="zm-slider">
        <input
          type="range"
          min="0.4"
          max="6"
          step="0.2"
          :value="settings.lineWidthStart"
          @input="(e) => set('lineWidthStart', parseFloat((e.target as HTMLInputElement).value))"
        />
      </div>

      <div class="zm-settings-row">
        <span class="zm-settings-label">线条细端(子端)</span>
        <span class="zm-settings-value-tag">{{ endLabel }} ({{ settings.lineWidthEnd.toFixed(1) }})</span>
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
</style>
