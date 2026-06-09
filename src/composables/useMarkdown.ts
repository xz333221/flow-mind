/**
 * Markdown rendering for the node-note preview.  Exports a single
 * pure function `renderMarkdown(src)` that returns sanitized HTML
 * ready for `v-html` in NotePanel.vue.
 *
 * Pipeline:
 *   1. `marked.parse`  — markdown → HTML (gfm, single \n → <br>)
 *   2. custom renderer hooks fenced code blocks into the same
 *      `highlightCode` helper the rest of the app uses, so the
 *      on-canvas code block and the note preview highlight with
 *      the exact same set of registered languages.
 *   3. `DOMPurify.sanitize` strips anything that didn't come from
 *      the allowed tag / attribute set.  `class` is permitted so
 *      hljs's `hljs` and `hljs-*` classes survive.
 */
import { Marked, Renderer, type Tokens } from 'marked'
import DOMPurify from 'dompurify'
import { highlightCode } from './useRichContent'

// Marked instance with project-tuned options.  We use a fresh
// instance instead of `marked.setOptions` so the global state
// can't leak in from elsewhere.
const md = new Marked({
  gfm: true,
  breaks: true,
  pedantic: false,
  renderer: (() => {
    const r = new Renderer()
    // Route fenced code through our existing hljs setup.
    r.code = ({ text, lang }: Tokens.Code): string => {
      const langTag = (lang ?? '').toLowerCase()
      const html = highlightCode(text, langTag)
      const cls = langTag ? ` class="language-${langTag}"` : ''
      return `<pre><code${cls}>${html}</code></pre>`
    }
    return r
  })(),
})

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'del', 's', 'u', 'a',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'code', 'pre', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'img', 'span', 'input',
]

const ALLOWED_ATTR = [
  'href', 'title', 'target', 'rel',
  'src', 'alt',
  'class',
  'checked', 'type', 'disabled',
]

// Standard safe-URI allowlist: http(s), mailto, tel, data (for
// embedded images), plus relative URLs.
const ALLOWED_URI_REGEXP =
  /^(?:(?:https?|mailto|tel|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i

/**
 * Render a markdown string to sanitized HTML.  Returns `''` for
 * empty input so the caller can use the result in a `v-html` v-if
 * without a separate guard.
 */
export function renderMarkdown(src: string): string {
  if (!src) return ''
  const raw = md.parse(src, { async: false }) as string
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
  })
}
