// Compare node positions between demo/1.html (with flow-mind's 3-child data)
// and the running flow-mind dev server. Captures screenshots and prints a
// per-node center (x, y) table from each side.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const outDir = 'verify-output'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()

// ====== Part 1: demo/1.html (with the swapped data) ======
console.log('===== Part 1: demo/1-test.html =====')
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const url = 'file://' + process.cwd().replace(/\\/g, '/') + '/verify-output/1-test.html'
  await page.goto(url, { waitUntil: 'networkidle' })
  // Wait for fitToScreen's setTimeout(100ms) + animation settle (CSS
  // transition d .35s ease on path stroke) + 500ms extra.
  await page.waitForSelector('.mind-node', { timeout: 8000 })
  await page.waitForTimeout(1000) // 100ms setTimeout + 350ms transition + 500ms buffer
  await page.screenshot({ path: `${outDir}/1-test-3children.png`, fullPage: false })

  // For demo/1.html: nodes are positioned via `left/top` AND centered by
  // `transform: translate(-50%, -50%)`, so the (left, top) is already
  // the center. We also compute the bounding-box center as a sanity check.
  const positions = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.mind-node')).map((el) => {
      const r = el.getBoundingClientRect()
      const text = el.querySelector('.node-text')?.textContent?.trim() ?? ''
      const className = el.className
      return {
        text,
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
        cssClass: className,
      }
    })
  })
  console.log('text | x | y | class')
  for (const p of positions) {
    console.log(`${p.text} | ${p.x} | ${p.y} | ${p.cssClass}`)
  }
  await page.close()
}

// ====== Part 2: flow-mind dev server ======
console.log('\n===== Part 2: flow-mind dev server (http://localhost:7851) =====')
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto('http://localhost:7851/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.zm-node', { timeout: 8000 })
  await page.waitForTimeout(1000) // post-init settle
  await page.screenshot({ path: `${outDir}/flowmind-3children.png`, fullPage: false })

  // flow-mind sets `left/top` to the corner (subtracts width/2 / height/2),
  // and centers with a different mechanism. The bounding-box center is
  // the safe value to compare against.
  const positions = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.zm-node')).map((el) => {
      const r = el.getBoundingClientRect()
      const text = el.querySelector('.zm-text')?.textContent?.trim() ?? ''
      // Compose a comparable CSS class string: root => "root-node",
      // otherwise flowmind uses "zm-node" + a depth-aware level via the
      // computed branch color.  We expose: class + data-node-id.
      const className = el.className
      return {
        text,
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
        cssClass: className,
        nodeId: el.getAttribute('data-node-id'),
      }
    })
  })
  console.log('text | x | y | class | data-node-id')
  for (const p of positions) {
    console.log(`${p.text} | ${p.x} | ${p.y} | ${p.cssClass} | ${p.nodeId}`)
  }
  await page.close()
}

await browser.close()
console.log('\nDONE')
