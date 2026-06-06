import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const url = process.env.URL || 'http://localhost:7851/'
const outDir = 'verify-output'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const errors = []
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-node', { timeout: 8000 })
await page.waitForTimeout(500)
await page.screenshot({ path: `${outDir}/01-initial.png`, fullPage: true })

// count nodes
const nodeCount = await page.locator('.zm-node').count()
console.log(`rendered nodes: ${nodeCount}`)

// check SVG edges
const edgeCount = await page.locator('.zm-edges path').count()
console.log(`rendered edges: ${edgeCount}`)

// hover a node to show buttons, then add a child
const firstNode = page.locator('.zm-node').nth(1)
await firstNode.hover()
await page.waitForTimeout(200)
await page.screenshot({ path: `${outDir}/02-hover.png` })

// click a branch node (e.g. "核心功能") and press Tab to add child
await firstNode.click()
await page.waitForTimeout(150)
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/03-after-add.png` })
const nodeCountAfter = await page.locator('.zm-node').count()
console.log(`nodes after add: ${nodeCountAfter}`)

// type a name and press Enter to commit
await page.keyboard.type('Tab 创建的子节点')
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
await page.screenshot({ path: `${outDir}/04-after-edit.png` })

// zoom in via toolbar
await page.locator('.zm-tb-btn').first().click()
await page.locator('.zm-tb-btn').first().click()
await page.waitForTimeout(150)
await page.screenshot({ path: `${outDir}/05-zoomed.png` })

// reset view
await page.locator('.zm-tb-btn[title="重置视图"]').click()
await page.waitForTimeout(150)
await page.screenshot({ path: `${outDir}/06-reset.png`, fullPage: true })

// drag persistence: drag the "核心功能" node and check it stays moved
const target = page.locator('.zm-node').nth(1)
const before = await target.boundingBox()
await target.hover()
await page.mouse.down()
await page.mouse.move(before.x + 250, before.y - 80, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(200)
const after = await target.boundingBox()
const dx = after.x - before.x
const dy = after.y - before.y
console.log(`drag delta: dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`)
if (Math.abs(dx) < 100 || Math.abs(dy) < 50) {
  console.error('drag did not persist!')
  process.exit(1)
}
await page.screenshot({ path: `${outDir}/07-after-drag.png`, fullPage: true })

// debug: log all node positions
const positions = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.zm-node')).map((n) => {
    const r = n.getBoundingClientRect()
    return { text: n.textContent?.trim().slice(0, 12), x: Math.round(r.x), y: Math.round(r.y) }
  })
})
console.log('positions after drag:')
for (const p of positions) console.log(' ', p)

// keyboard: select "技术栈", press Tab to add a child (it should enter
// edit mode), type some text, press Enter to commit + add a sibling,
// then Ctrl+Z to undo the add-sibling.
const techNode = page.locator('.zm-node:has-text("技术栈")').first()
await techNode.click()
await page.waitForTimeout(150)
const nodesBefore = await page.locator('.zm-node').count()
await page.keyboard.press('Tab')
await page.waitForTimeout(250)
const nodesAfterTab = await page.locator('.zm-node').count()
if (nodesAfterTab !== nodesBefore + 1) {
  console.error(`Tab should add a child: was ${nodesBefore}, now ${nodesAfterTab}`)
  process.exit(1)
}
await page.keyboard.type('Foo')
await page.keyboard.press('Enter')
await page.waitForTimeout(250)
const nodesAfterEnter = await page.locator('.zm-node').count()
if (nodesAfterEnter !== nodesAfterTab + 1) {
  console.error(`Enter should commit + add sibling: ${nodesAfterTab} → ${nodesAfterEnter}`)
  process.exit(1)
}
console.log(`Tab + Enter: ${nodesBefore} → ${nodesAfterTab} → ${nodesAfterEnter}`)

// Ctrl+Z to undo the add-sibling
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await page.waitForTimeout(250)
const nodesAfterUndo = await page.locator('.zm-node').count()
if (nodesAfterUndo !== nodesAfterTab) {
  console.error(`Ctrl+Z should undo add-sibling: ${nodesAfterTab} → ${nodesAfterUndo}`)
  process.exit(1)
}
console.log(`Ctrl+Z: ${nodesAfterEnter} → ${nodesAfterUndo} ✓`)

// also test that Shift+Enter adds a sibling BEFORE the current node.
// Click "Vue 3 + Vite" (first child of 技术栈) and press Shift+Enter —
// a new node should be inserted before it.
const vueNode = page.locator('.zm-node:has-text("Vue 3 + Vite")').first()
await vueNode.click()
await page.waitForTimeout(150)
const beforeSiblingBefore = await page.locator('.zm-node').count()
await page.keyboard.down('Shift')
await page.keyboard.press('Enter')
await page.keyboard.up('Shift')
await page.waitForTimeout(250)
const afterSiblingBefore = await page.locator('.zm-node').count()
if (afterSiblingBefore !== beforeSiblingBefore + 1) {
  console.error(
    `Shift+Enter should add sibling before: ${beforeSiblingBefore} → ${afterSiblingBefore}`
  )
  process.exit(1)
}
console.log(`Shift+Enter: ${beforeSiblingBefore} → ${afterSiblingBefore} ✓`)
await page.keyboard.press('Escape')
await page.waitForTimeout(150)

// balance command: click the balance button, verify it (1) clears the
// drag offsets we just set so the "核心功能" node returns to its
// algorithm position, and (2) lays out all sub-branches in the balanced
// mode (left-side children centered in the right-side band).
const balanceBtn = page.locator('.zm-tb-btn[title*="平衡"]')
await balanceBtn.click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/08-balanced.png`, fullPage: true })

// after balance: the dragged "核心功能" should NOT be in the corner
// anymore — it should sit on its algorithm-defined row on the right side
const balancedPositions = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.zm-node')).map((n) => {
    const r = n.getBoundingClientRect()
    return { text: n.textContent?.trim().slice(0, 12), x: Math.round(r.x), y: Math.round(r.y) }
  })
})
console.log('positions when balanced:')
for (const p of balancedPositions) console.log(' ', p)

const coreNodeBalanced = balancedPositions.find((p) => p.text === '核心功能')
if (!coreNodeBalanced || coreNodeBalanced.x > 900) {
  console.error(`balance did not restore "核心功能" to its algorithm position (x=${coreNodeBalanced?.x})`)
  process.exit(1)
}
console.log(`balance restored 核心功能 to x=${coreNodeBalanced.x}`)

// App layout: drawers are closed by default — open them, then assert
// their content renders.
await page.locator('.zm-app-icon-btn[title="显示大纲"]').click()
await page.waitForTimeout(250)
await page.locator('.zm-app-icon-btn[title="显示数据"]').click()
await page.waitForTimeout(250)
const outlineRows = await page.locator('.zm-outline-row').count()
const dataPre = await page.locator('.zm-data-pre').count()
console.log(`outline rows: ${outlineRows}, data panels: ${dataPre}`)
if (outlineRows < 14) {
  console.error(`expected at least 14 outline rows, got ${outlineRows}`)
  process.exit(1)
}
if (dataPre !== 1) {
  console.error(`expected 1 data panel, got ${dataPre}`)
  process.exit(1)
}

// copy button: verify the JSON in clipboard matches the source data
// (We can't read the system clipboard in headless Chromium without a
// permission grant, so instead we assert the copy button flips its
// label/state.)
await page.locator('.zm-data-btn:has-text("复制 JSON")').click()
await page.waitForTimeout(200)
const copyState = await page.locator('.zm-data-btn.is-success').count()
if (copyState !== 1) {
  console.error('copy button did not flip to success state')
  process.exit(1)
}

// download export: verify the file gets generated.  Listen on
// page.on('download') and assert the filename.
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('.zm-data-btn:has-text("导出文件")').click(),
])
console.log(`download filename: ${download.suggestedFilename()}`)
if (!download.suggestedFilename().endsWith('.json')) {
  console.error(`export did not produce a .json file: ${download.suggestedFilename()}`)
  process.exit(1)
}

// close the outline drawer and re-open it via the toolbar button
await page.locator('.zm-drawer--left .zm-drawer-close').click()
await page.waitForTimeout(300)
const outlineAfterClose = await page.locator('.zm-outline-row').count()
if (outlineAfterClose !== 0) {
  console.error(`expected 0 outline rows after close, got ${outlineAfterClose}`)
  process.exit(1)
}
await page.locator('.zm-app-icon-btn[title="显示大纲"]').click()
await page.waitForTimeout(300)
const outlineAfterReopen = await page.locator('.zm-outline-row').count()
if (outlineAfterReopen < 14) {
  console.error(`expected at least 14 outline rows after reopen, got ${outlineAfterReopen}`)
  process.exit(1)
}

// outline row copy: hover the first row, then click its copy button.  We
// can't read the system clipboard in headless Chromium without a
// permission grant, so we assert the row's copy button flips to the
// "is-success" state.
const firstRow = page.locator('.zm-outline-row').first()
await firstRow.hover()
await page.waitForTimeout(100)
const rowCopy = firstRow.locator('.zm-outline-row-copy')
await rowCopy.click()
await page.waitForTimeout(150)
const rowCopySuccess = await rowCopy.evaluate((el) => el.classList.contains('is-success'))
if (!rowCopySuccess) {
  console.error('outline row copy did not flip to success state')
  process.exit(1)
}
console.log('outline row copy: success')

// outline action button "复制大纲"
const outlineAction = page.locator('.zm-outline-action-btn')
await outlineAction.click()
await page.waitForTimeout(150)
const outlineActionSuccess = await outlineAction.evaluate((el) => el.classList.contains('is-success'))
if (!outlineActionSuccess) {
  console.error('outline action copy did not flip to success state')
  process.exit(1)
}
console.log('outline action copy: success')

await page.screenshot({ path: `${outDir}/09-app-drawers.png`, fullPage: true })

await browser.close()

if (errors.length) {
  console.error('ERRORS:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log('VERIFY OK')
