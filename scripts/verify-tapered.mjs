import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const url = process.env.URL || 'http://localhost:7851/'
const outDir = 'E:\\workspace\\github_workspace\\flow-mindmap\\verify-output'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

const consoleErrors = []
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`)
})

// =====================================================================
// 1. Default load
// =====================================================================
console.log('=== 1. Default load ===')
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-node', { timeout: 8000 })
await page.waitForTimeout(1500)
console.log('[init] page ready')

// Read all SVG path elements
const paths = await page.evaluate(() => {
  const pathEls = document.querySelectorAll('svg path')
  return Array.from(pathEls).map((p, i) => {
    const d = p.getAttribute('d') || ''
    return {
      i,
      d: d.length > 200 ? d.substring(0, 200) + '...' : d,
      dFull: d,
      fill: p.getAttribute('fill'),
      stroke: p.getAttribute('stroke'),
      strokeWidth: p.getAttribute('stroke-width'),
    }
  })
})

console.log(`\n[paths] total: ${paths.length}`)
paths.slice(0, 10).forEach((p) => {
  console.log(`\n  [path ${p.i}]`)
  console.log(`    fill: ${p.fill}`)
  console.log(`    stroke: ${p.stroke}`)
  console.log(`    stroke-width: ${p.strokeWidth}`)
  console.log(`    d (truncated): ${p.d}`)
})

// Print full d for 2-3 paths
console.log('\n\n=== Full d samples ===')
const samples = paths.slice(0, 3)
samples.forEach((p) => {
  console.log(`\n[path ${p.i} FULL d]:`)
  console.log(p.dFull)
})

// Take screenshot
await page.screenshot({ path: `${outDir}\\tapered-edges.png`, fullPage: false })
console.log('\n[saved] tapered-edges.png')

// =====================================================================
// 2. Fan data
// =====================================================================
console.log('\n\n=== 2. Fan data ===')
await page.goto(url + '#fan', { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-node', { timeout: 8000 })
await page.waitForTimeout(1500)

const fanPaths = await page.evaluate(() => {
  const pathEls = document.querySelectorAll('svg path')
  return Array.from(pathEls).map((p) => ({
    fill: p.getAttribute('fill'),
    stroke: p.getAttribute('stroke'),
    dLen: (p.getAttribute('d') || '').length,
  }))
})
console.log(`[fan paths] total: ${fanPaths.length}`)
fanPaths.slice(0, 3).forEach((p, i) => {
  console.log(`  [fan ${i}] fill=${p.fill} stroke=${p.stroke} dLen=${p.dLen}`)
})

await page.screenshot({ path: `${outDir}\\tapered-fan.png`, fullPage: false })
console.log('[saved] tapered-fan.png')

// =====================================================================
// 3. Stress data
// =====================================================================
console.log('\n\n=== 3. Stress data ===')
await page.goto(url + '#stress', { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-node', { timeout: 8000 })
await page.waitForTimeout(1500)

const stressPaths = await page.evaluate(() => {
  const pathEls = document.querySelectorAll('svg path')
  return Array.from(pathEls).map((p) => ({
    fill: p.getAttribute('fill'),
    stroke: p.getAttribute('stroke'),
    dLen: (p.getAttribute('d') || '').length,
  }))
})
console.log(`[stress paths] total: ${stressPaths.length}`)
stressPaths.slice(0, 3).forEach((p, i) => {
  console.log(`  [stress ${i}] fill=${p.fill} stroke=${p.stroke} dLen=${p.dLen}`)
})

await page.screenshot({ path: `${outDir}\\tapered-stress.png`, fullPage: false })
console.log('[saved] tapered-stress.png')

// =====================================================================
// 4. Org mode
// =====================================================================
console.log('\n\n=== 4. Org mode ===')
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-node', { timeout: 8000 })
await page.waitForTimeout(1500)

// Click "组织结构布局" button (title="组织结构布局 (向下展开)")
const orgButton = page.locator('button[title*="组织结构"]').first()
const btnCount = await orgButton.count()
console.log(`[org btn] found: ${btnCount}`)

if (btnCount > 0) {
  await orgButton.click()
  await page.waitForTimeout(1500)
}

const orgPaths = await page.evaluate(() => {
  const pathEls = document.querySelectorAll('svg path')
  return Array.from(pathEls).map((p, i) => {
    const d = p.getAttribute('d') || ''
    return {
      i,
      fill: p.getAttribute('fill'),
      stroke: p.getAttribute('stroke'),
      dFirst100: d.substring(0, 100),
      dLast100: d.length > 100 ? d.substring(d.length - 100) : d,
    }
  })
})
console.log(`[org paths] total: ${orgPaths.length}`)
orgPaths.slice(0, 3).forEach((p) => {
  console.log(`\n  [org ${p.i}] fill=${p.fill} stroke=${p.stroke}`)
  console.log(`    d first100: ${p.dFirst100}`)
  console.log(`    d last100:  ${p.dLast100}`)
})

await page.screenshot({ path: `${outDir}\\tapered-org.png`, fullPage: false })
console.log('[saved] tapered-org.png')

// =====================================================================
// Summary
// =====================================================================
console.log('\n\n=== Summary ===')
console.log(`Console errors: ${consoleErrors.length}`)
consoleErrors.slice(0, 5).forEach((e) => console.log(`  ${e}`))

await browser.close()
console.log('\n[done]')
