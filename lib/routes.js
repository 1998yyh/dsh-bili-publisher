import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { validId, itemDir } from './store.js'
import { previewHtml } from './render.js'

export function rangeFor(header, size) {
  if (!header) return { start: 0, end: size - 1, status: 200 }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2])) return null
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  let end = match[1] && match[2] ? Number(match[2]) : size - 1
  if (![start, end].every(Number.isSafeInteger) || start < 0 || start >= size || end < start) return null
  end = Math.min(end, size - 1)
  return { start, end, status: 206 }
}

export function mountRoutes(ctx, service) {
  if (!ctx.webServer || !ctx.connection) return
  const dispose = ctx.webServer.register({ kind: 'prefix', path: '/bili-publisher/jobs/', async handler(req, res) {
    try {
      let rejection
      try { rejection = ctx.connection.requestRejection(req) } catch { res.writeHead(503); res.end(); return }
      if (rejection !== undefined && rejection !== null && rejection !== false) { res.writeHead(typeof rejection === 'number' ? rejection : 403); res.end(); return }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return }
      const match = /^\/bili-publisher\/jobs\/([^/]+)\/(preview\.mp4|poster\.jpg|subtitles\.srt|preview\.html)?$/.exec(new URL(req.url, 'http://dsh.internal').pathname)
      if (!match || !validId(match[1])) { res.writeHead(404); res.end(); return }
      const job = await service.getJob(match[1])
      const common = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; media-src 'self'; img-src 'self'; frame-ancestors 'self'" }
      if (!match[2] || match[2] === 'preview.html') { res.writeHead(200, { ...common, 'Content-Type': 'text/html; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : previewHtml(job)); return }
      if (job.state !== 'completed') { res.writeHead(409); res.end(); return }
      const config = await service.configuration(), file = path.join(itemDir(config, 'jobs', match[1]), match[2])
      const stat = await fsp.stat(file), range = rangeFor(req.headers.range, stat.size)
      if (!range) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return }
      const mime = { 'preview.mp4': 'video/mp4', 'poster.jpg': 'image/jpeg', 'subtitles.srt': 'text/plain; charset=utf-8' }[match[2]]
      res.writeHead(range.status, { ...common, 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Content-Length': range.end - range.start + 1, ...(range.status === 206 ? { 'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}` } : {}) })
      if (req.method === 'HEAD') { res.end(); return }
      await pipeline(fs.createReadStream(file, { start: range.start, end: range.end }), res)
    } catch { if (!res.headersSent) res.writeHead(404); res.end() }
  } })
  ctx.effect?.(() => dispose)
}
