/**
 * Share a Markdown or HTML file a session produced as a web page link:
 * `https://share.traecontent.cn/artifact/<id>`.
 *
 * This is TRAE SOLO CN's "share an HTML artifact" (solo-lite 0.1.61,
 * `424.d691e580.mjs`: `V` / `et` / `er` / `ea`; report v3 §6), four steps:
 *
 *   1. POST {remote}/api/remote/v1/share/local_artifact/presign-upload
 *      { local_session_id, artifact_path, content_length, content_hash }
 *      → { upload_url, upload_headers, resource_uri }
 *   2. PUT upload_url   body = package.zip   headers = upload_headers
 *   3. POST {remote}/api/remote/v1/share/local_artifact
 *      { local_session_id, artifact_path, resource_uri, content_hash }
 *      → { share_session_id, status, expires_at, … }
 *   4. the page: {share origin}/artifact/<share_session_id>
 *
 * The zip holds the entry at `artifact_path` and the files it references at
 * their paths relative to the same root, as the client packs a workspace.
 * `(local_session_id, artifact_path)` is the server's key: sharing the same
 * file again replaces the content and keeps the link.
 *
 * What goes into the package is deliberately narrow, because the link is
 * public and the page is served from Trae's own domain:
 *
 * - the entry must be `.html` / `.htm` / `.md` / `.markdown`, an absolute path,
 *   a regular file;
 * - assets are only what the entry (and the CSS it pulls in) references by a
 *   relative path, and only inside the entry's own directory — never `..`,
 *   never a dotfile, never another archive (the server refuses nested zips);
 * - at most 200 files and 50 MB, the client's own limits.
 *
 * Markdown is rendered to a standalone, styled HTML page first (`marked`,
 * bundled at build time), so the link opens as a readable document.
 */

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, sep } from 'node:path'
import { marked } from 'marked'

/** Client limits for one artifact package (`local artifact package exceeds …`). */
export const ARTIFACT_MAX_FILES = 200
export const ARTIFACT_MAX_BYTES = 50 * 1024 * 1024

const ENTRY_EXTENSIONS = new Set(['.html', '.htm', '.md', '.markdown'])
const MARKDOWN = new Set(['.md', '.markdown'])

export type ArtifactKind = 'html' | 'markdown'

/** Whether a path names a file this module can share. */
export function artifactKind(path: string): ArtifactKind | undefined {
  const ext = extname(path).toLowerCase()
  if (!ENTRY_EXTENSIONS.has(ext)) return undefined
  return MARKDOWN.has(ext) ? 'markdown' : 'html'
}

export class ArtifactError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactError'
  }
}

// ------------------------------------------------------------------ zip

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * A zip of `files`, stored (no compression): the content is mostly HTML and
 * images, the server unpacks it to audit it anyway, and a stored archive
 * needs nothing beyond a CRC. Names are UTF-8 (general-purpose flag bit 11).
 */
export function zipStore(files: readonly { path: string; data: Uint8Array }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.path, 'utf8')
    const data = Buffer.from(file.data)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0x21, 12) // date: 1980-01-01
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // made by
    central.writeUInt16LE(20, 6) // needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

// ------------------------------------------------------------- markdown

const PAGE_CSS = `
:root{color-scheme:light dark;--fg:#1f2328;--muted:#59636e;--line:#d1d9e0;--soft:#f6f8fa;--link:#0969da;--code:#eff1f3}
@media (prefers-color-scheme:dark){:root{--fg:#e6edf3;--muted:#9198a1;--line:#3d444d;--soft:#151b23;--link:#4493f8;--code:#262c36}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:Canvas;color:var(--fg);font:16px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
main{max-width:820px;margin:0 auto;padding:48px 24px 96px}
h1,h2,h3,h4{line-height:1.3;margin:1.8em 0 .6em;font-weight:650}
h1{font-size:2em;margin-top:0;padding-bottom:.3em;border-bottom:1px solid var(--line)}
h2{font-size:1.5em;padding-bottom:.25em;border-bottom:1px solid var(--line)}
h3{font-size:1.25em}
p,ul,ol,blockquote,table,pre{margin:0 0 1em}
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
img{max-width:100%;height:auto;border-radius:6px}
hr{border:0;border-top:1px solid var(--line);margin:2em 0}
blockquote{padding:.2em 1em;color:var(--muted);border-left:4px solid var(--line)}
code{font:.875em/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code);padding:.15em .4em;border-radius:6px}
pre{padding:16px;overflow:auto;background:var(--soft);border:1px solid var(--line);border-radius:8px}
pre code{background:none;padding:0;font-size:.85em}
table{display:block;overflow:auto;border-collapse:collapse;max-width:100%}
th,td{padding:6px 13px;border:1px solid var(--line)}
th{background:var(--soft);font-weight:600}
li+li{margin-top:.25em}
`

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A Markdown document as a standalone page, titled by its first heading (else `fallbackTitle`). */
export function markdownPage(markdown: string, fallbackTitle: string): string {
  const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(markdown)?.[1]
  const title = heading?.replace(/[*_`[\]]/g, '').trim() || fallbackTitle
  const body = marked.parse(markdown, { async: false, gfm: true }) as string
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body><main>
${body}
</main></body>
</html>
`
}

// --------------------------------------------------------------- assets

/** Relative references in HTML (src / href / srcset / poster) and CSS (url(), @import). */
export function references(text: string, kind: 'html' | 'css'): string[] {
  const out: string[] = []
  const add = (raw: string | undefined): void => {
    const value = raw?.trim()
    if (!value) return
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#|\{)/i.test(value)) return // absolute, protocol-relative, root, fragment, template
    const clean = value.split(/[?#]/)[0]
    if (clean) out.push(clean)
  }
  if (kind === 'html') {
    for (const m of text.matchAll(/\b(?:src|href|poster|data-src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi)) add(m[1] ?? m[2] ?? m[3])
    for (const m of text.matchAll(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      for (const part of (m[1] ?? m[2] ?? '').split(',')) add(part.trim().split(/\s+/)[0])
    }
    for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) out.push(...references(m[1] ?? '', 'css'))
    for (const m of text.matchAll(/\bstyle\s*=\s*"([^"]*)"/gi)) out.push(...references(m[1] ?? '', 'css'))
  } else {
    for (const m of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi)) add(m[1] ?? m[2] ?? m[3])
    for (const m of text.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) add(m[1] ?? m[2])
  }
  return out
}

const safeDecode = (value: string): string => {
  try { return decodeURIComponent(value) } catch { return value }
}

/** A folder label for the zip root: the directory's name plus a short hash of its full path. */
function rootLabel(dir: string): string {
  const name = basename(dir).replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').slice(0, 48) || 'artifact'
  return `${name}-${createHash('sha1').update(dir).digest('hex').slice(0, 6)}`
}

export interface ArtifactPackage {
  /** The entry's path inside the zip — the share's `artifact_path`. */
  artifactPath: string
  zip: Buffer
  /** `sha256:<hex>` of `zip`. */
  contentHash: string
  /** Every path packed, entry first. */
  files: string[]
  kind: ArtifactKind
  /** The file on disk the package was built from. */
  source: string
}

/**
 * Read `path` and everything it references inside its own directory into a
 * package ready for upload. Throws `ArtifactError` with a reason a person can
 * act on (wrong type, missing, too big, …).
 */
export async function packArtifact(path: string): Promise<ArtifactPackage> {
  if (!isAbsolute(path)) throw new ArtifactError(`需要绝对路径：${path}`)
  const source = normalize(path)
  const kind = artifactKind(source)
  if (!kind) throw new ArtifactError('只能分享 .html / .htm / .md / .markdown 文件')
  let info
  try { info = await stat(source) } catch { throw new ArtifactError(`文件不存在：${source}`) }
  if (!info.isFile()) throw new ArtifactError(`不是文件：${source}`)
  if (info.size > ARTIFACT_MAX_BYTES) throw new ArtifactError(`文件超过 50 MB：${source}`)

  const root = dirname(source)
  const label = rootLabel(root)
  const files = new Map<string, Uint8Array>()
  let bytes = 0
  const keep = (relativePath: string, data: Uint8Array): void => {
    if (files.size + 1 > ARTIFACT_MAX_FILES) throw new ArtifactError(`要打包的文件超过 ${ARTIFACT_MAX_FILES} 个`)
    bytes += data.byteLength
    if (bytes > ARTIFACT_MAX_BYTES) throw new ArtifactError('要打包的文件合计超过 50 MB')
    files.set(relativePath, data)
  }

  // The entry: Markdown becomes a page named after it.
  const raw = await readFile(source)
  const entryName = kind === 'markdown' ? `${basename(source, extname(source))}.html` : basename(source)
  const entryHtml = kind === 'markdown'
    ? markdownPage(raw.toString('utf8'), basename(source, extname(source)))
    : raw.toString('utf8')
  keep(entryName, Buffer.from(entryHtml, 'utf8'))

  // Assets, breadth first: what the entry references, then what referenced CSS
  // / HTML references in turn. Missing or out-of-bounds references are skipped
  // (the page shows them broken, as it would anywhere else).
  const queue: { from: string; text: string; kind: 'html' | 'css' }[] = [{ from: root, text: entryHtml, kind: 'html' }]
  const seen = new Set<string>([join(root, entryName)])
  while (queue.length > 0) {
    const { from, text, kind: textKind } = queue.shift()!
    for (const reference of references(text, textKind)) {
      const target = normalize(join(from, safeDecode(reference)))
      const inside = relative(root, target)
      if (!inside || inside.startsWith('..') || isAbsolute(inside)) continue
      if (inside.split(sep).some(part => part.startsWith('.'))) continue
      if (/\.(?:zip|jar|rar|7z|tar|gz|tgz)$/i.test(target)) continue
      if (seen.has(target)) continue
      seen.add(target)
      let data: Buffer
      try {
        const s = await stat(target)
        if (!s.isFile()) continue
        data = await readFile(target)
      } catch { continue }
      keep(inside.split(sep).join('/'), data)
      const ext = extname(target).toLowerCase()
      if (ext === '.css') queue.push({ from: dirname(target), text: data.toString('utf8'), kind: 'css' })
      else if (ext === '.html' || ext === '.htm') queue.push({ from: dirname(target), text: data.toString('utf8'), kind: 'html' })
    }
  }

  const entries = [...files].map(([relativePath, data]) => ({ path: `${label}/${relativePath}`, data }))
  const zip = zipStore(entries)
  return {
    artifactPath: `${label}/${entryName}`,
    zip,
    contentHash: `sha256:${createHash('sha256').update(zip).digest('hex')}`,
    files: entries.map(entry => entry.path),
    kind,
    source,
  }
}
