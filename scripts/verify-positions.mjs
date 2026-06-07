// Compare node positions between demo/1-test.html (flow-mind 3-node data)
// and the running flow-mind dev server, and capture the screenshots asked
// for in the task. Output: PNGs + a per-node position table.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const outDir = 'verify-output'
mkdirSync(outDir, { recursive: true })

// 1) Build the demo test HTML with the 3-node flow-mind style data.
const demoPath = 'demo/1.html'
const SAMPLE = {
  id: 'root',
  text: 'flow-mind 思维导图',
  collapsed: false,
  children: [
    {
      id: 'n_features', text: '核心功能', collapsed: false,
      children: [
        { id: 'n_f1', text: '节点增删改', collapsed: false, children: [] },
        { id: 'n_f2', text: '拖拽布局', collapsed: false, children: [] },
        { id: 'n_f3', text: '缩放与平移', collapsed: false, children: [] },
        { id: 'n_f4', text: '键盘快捷键', collapsed: false, children: [] },
      ],
    },
    {
      id: 'n_tech', text: '技术栈', collapsed: false,
      children: [
        { id: 'n_t1', text: 'Vue 3 + Vite', collapsed: false, children: [] },
        { id: 'n_t2', text: 'TypeScript', collapsed: false, children: [] },
        { id: 'n_t3', text: '纯 SVG 渲染', collapsed: false, children: [] },
      ],
    },
    {
      id: 'n_open', text: '开源', collapsed: false,
      children: [
        { id: 'n_o1', text: 'MIT 协议', collapsed: false, children: [] },
        { id: 'n_o2', text: '可作为 npm 组件使用', collapsed: false, children: [] },
      ],
    },
  ],
}
let html = readFileSync(demoPath, 'utf-8')
const newFunc = `function createInitialData() {\n  return ${JSON.stringify(SAMPLE, null, 2)};\n}`
html = html.replace(/function createInitialData\(\) \{[\s\S]*?\n\}/, newFunc)
const testHtmlPath = resolve(outDir, '1-test.html')
writeFileSync(testHtmlPath, html, 'utf-8')
console.log('Wrote demo test file:', testHtmlPath)

const browser = await chromium.launch()

// ============== Part 1: demo/1-test.html ==============
console.log('\n===== Part 1: demo/1-test.html =====')
const demoPositions = {}
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const url = 'file:///' + testHtmlPath.replace(/\\/g, '/')
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('.mind-node', { timeout: 8000 })
  // fitToScreen setTimeout 100ms + transition 350ms + 500ms buffer
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${outDir}/1-test-3k.png`, fullPage: false })

  const positions = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.mind-node')).map((el) => {
      const r = el.getBoundingClientRect()
      const text = el.querySelector('.node-text')?.textContent?.trim() ?? ''
      return {
        text,
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
        cssClass: el.className,
      }
    })
  })
  console.log('text | x | y | class')
  for (const p of positions) {
    console.log(`${p.text} | ${p.x} | ${p.y} | ${p.cssClass}`)
    demoPositions[p.text] = p
  }
  await page.close()
}

// ============== Part 2: flow-mind dev server ==============
console.log('\n===== Part 2: flow-mind dev server =====')
const flowmindPositions = {}
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto('http://localhost:7851/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.zm-node', { timeout: 8000 })
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${outDir}/flowmind-3k.png`, fullPage: false })

  const positions = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.zm-node')).map((el) => {
      const r = el.getBoundingClientRect()
      const text = el.querySelector('.zm-text')?.textContent?.trim() ?? ''
      return {
        text,
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
        cssClass: el.className,
        nodeId: el.getAttribute('data-node-id'),
      }
    })
  })
  console.log('text | x | y | data-node-id')
  for (const p of positions) {
    console.log(`${p.text} | ${p.x} | ${p.y} | ${p.nodeId}`)
    flowmindPositions[p.text] = p
  }
  await page.close()
}

// ============== Part 4: tree / org layouts ==============
console.log('\n===== Part 4: flow-mind tree / org layouts =====')
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto('http://localhost:7851/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.zm-node', { timeout: 8000 })
  await page.waitForTimeout(500)

  // Click "树形布局" by title attribute.
  await page.locator('button[title^="树形布局"]').click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${outDir}/flowmind-tree.png`, fullPage: false })
  console.log('Saved flowmind-tree.png')

  // Click "组织结构布局" by title attribute.
  await page.locator('button[title^="组织结构布局"]').click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${outDir}/flowmind-org.png`, fullPage: false })
  console.log('Saved flowmind-org.png')

  await page.close()
}

await browser.close()

// ============== Part 3: Comparison table ==============
console.log('\n===== Comparison table (absolute) =====')
const allTexts = new Set([...Object.keys(demoPositions), ...Object.keys(flowmindPositions)])
const rows = []
for (const text of allTexts) {
  const d = demoPositions[text]
  const z = flowmindPositions[text]
  if (!d || !z) {
    rows.push({ text, d: d ? `${d.x},${d.y}` : '—', z: z ? `${z.x},${z.y}` : '—', dx: '—', dy: '—' })
    continue
  }
  rows.push({
    text,
    d: `${d.x},${d.y}`,
    z: `${z.x},${z.y}`,
    dx: Math.abs(d.x - z.x),
    dy: Math.abs(d.y - z.y),
  })
}
console.log('text'.padEnd(20) + ' | demo (x,y)'.padEnd(14) + ' | flowmind (x,y)'.padEnd(18) + ' | |Δx|'.padEnd(6) + ' | |Δy|')
console.log('-'.repeat(75))
let maxDx = 0, maxDy = 0
for (const r of rows) {
  console.log(
    r.text.padEnd(20) + ' | ' +
    String(r.d).padEnd(14) + ' | ' +
    String(r.z).padEnd(15) + ' | ' +
    String(r.dx).padEnd(6) + ' | ' +
    String(r.dy)
  )
  if (typeof r.dx === 'number' && r.dx > maxDx) maxDx = r.dx
  if (typeof r.dy === 'number' && r.dy > maxDy) maxDy = r.dy
}
console.log(`\nAbsolute Max |Δx| = ${maxDx}px, Max |Δy| = ${maxDy}px`)

// Shape comparison: normalize by subtracting each side's root position
// to cancel the global pan/zoom offset.
const dRoot = demoPositions['flow-mind 思维导图']
const zRoot = flowmindPositions['flow-mind 思维导图']
if (dRoot && zRoot) {
  console.log('\n===== Shape comparison (offsets relative to root) =====')
  console.log('text'.padEnd(20) + ' | demo (dx,dy)'.padEnd(16) + ' | flowmind (dx,dy)'.padEnd(18) + ' | |Δdx| |Δdy|')
  console.log('-'.repeat(75))
  let shapeMaxDx = 0, shapeMaxDy = 0
  for (const text of allTexts) {
    const d = demoPositions[text], z = flowmindPositions[text]
    if (!d || !z) continue
    const ddx = d.x - dRoot.x, ddy = d.y - dRoot.y
    const zdx = z.x - zRoot.x, zdy = z.y - zRoot.y
    const adx = Math.abs(ddx - zdx), ady = Math.abs(ddy - zdy)
    if (adx > shapeMaxDx) shapeMaxDx = adx
    if (ady > shapeMaxDy) shapeMaxDy = ady
    console.log(
      text.padEnd(20) + ' | ' +
      `(${ddx},${ddy})`.padEnd(16) + ' | ' +
      `(${zdx},${zdy})`.padEnd(18) + ' | ' +
      `${adx} ${ady}`
    )
  }
  console.log(`\nShape Max |Δdx| = ${shapeMaxDx}px, Max |Δdy| = ${shapeMaxDy}px`)
}

// Per-side internal shape — show that within each tree, the relative
// positions are consistent.  We compute pairwise |Δ| between the two
// sides for the same node pairs (a per-side distance check), and the
// "ratio" of those distances to see if the shape is preserved.
// Simplest signal: the x-offset of every right-side child should scale
// uniformly between demo and flowmind if shapes match.
const dRight = demoPositions['核心功能']
const zRight = flowmindPositions['核心功能']
if (dRight && zRight) {
  const dScale = (dRight.x - dRoot.x) / (zRight.x - zRoot.x)
  console.log(`\nRight side horizontal scale demo/flowmind = ${dScale.toFixed(3)} (close to 1 means shapes match)`)
}
const dLeft = demoPositions['开源']
const zLeft = flowmindPositions['开源']
if (dLeft && zLeft) {
  const dScale = (dRoot.x - dLeft.x) / (zRoot.x - zLeft.x)
  console.log(`Left  side horizontal scale demo/flowmind = ${dScale.toFixed(3)} (close to 1 means shapes match)`)
}
console.log('\nDONE')
