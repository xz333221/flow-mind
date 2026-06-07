// Smoke test for the rich Markdown 示例 in MarkdownPanel.vue.
// Loads the panel, clicks "示例" to populate the editor, then
// asserts the parsed preview tree contains image / link / note.
import { chromium } from 'playwright'

const url = process.env.URL || 'http://localhost:7851/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-node', { timeout: 8000 })

// Open the Markdown drawer.
await page.locator('.zm-app-icon-btn[title="显示 Markdown"]').click()
await page.waitForTimeout(250)

// The Markdown drawer has its own .zm-node elements (read-only
// preview); wait for the textarea too.
await page.waitForSelector('.zm-md-textarea', { timeout: 4000 })

// Click "示例" — populates the editor.
await page.locator('.zm-md-btn:has-text("示例")').click()
await page.waitForTimeout(400)

// Read back the editor content to confirm it has the right shape.
const md = await page.locator('.zm-md-textarea').inputValue()
console.log('STARTER length:', md.length)
if (!md.includes('![cover]')) throw new Error('missing image in starter')
if (!md.includes('[GitHub 仓库]')) throw new Error('missing link in starter')
if (!md.includes('```note')) throw new Error('missing note fence in starter')

// Preview pane shows the parsed mind map.  Assert the icons are
// present there.
const imgs = await page.locator('.zm-md-preview .zm-node-img').count()
const links = await page.locator('.zm-md-preview .zm-node-link').count()
const notes = await page.locator('.zm-md-preview .zm-node-note-btn').count()
console.log(`preview — images:${imgs} links:${links} notes:${notes}`)
if (imgs < 1) {
  console.error('expected at least 1 image in preview, got', imgs)
  await browser.close()
  process.exit(1)
}
if (links < 2) {
  // "GitHub 仓库" on root, "Apache-2.0" on 开源协议
  console.error('expected at least 2 links in preview, got', links)
  await browser.close()
  process.exit(1)
}
if (notes < 1) {
  console.error('expected at least 1 note in preview, got', notes)
  await browser.close()
  process.exit(1)
}

// Click "应用到导图" — this should replace the main data tree.
await page.locator('.zm-md-btn.is-primary:has-text("应用到导图")').click()
await page.waitForTimeout(500)

// Close the drawer to see the canvas.
await page.locator('.zm-drawer--right .zm-drawer-close').click()
await page.waitForTimeout(200)

await page.screenshot({ path: 'verify-output/14-md-extended.png', fullPage: true })

await browser.close()

if (errors.length) {
  console.error('ERRORS:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log('MD-EXTENDED VERIFY OK')
