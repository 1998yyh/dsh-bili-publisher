import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mountRoutes, rangeFor } from '../lib/routes.js'

test('range requests include suffixes, clamp endpoints and reject malformed input', () => {
  assert.deepEqual(rangeFor('bytes=2-4', 10), { start: 2, end: 4, status: 206 })
  assert.deepEqual(rangeFor('bytes=-3', 10), { start: 7, end: 9, status: 206 })
  assert.deepEqual(rangeFor('bytes=8-99', 10), { start: 8, end: 9, status: 206 })
  for (const header of ['bytes=10-', 'bytes=3-2', 'bytes=0-1,4-5', 'bytes=-0', 'bytes=-']) assert.equal(rangeFor(header, 10), null)
})

test('preview routes authenticate, escape text and serve only named artifacts with byte ranges', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'publisher-http-')); t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const id = randomUUID(), jobDir = path.join(dir, 'jobs', id); await fs.mkdir(jobDir, { recursive: true }); await fs.writeFile(path.join(jobDir, 'preview.mp4'), '0123456789')
  let route
  mountRoutes({ connection: { requestRejection: req => req.headers.authorization === 'test' ? undefined : 401 }, webServer: { register(value) { route = value; return () => {} } } }, {
    getJob: async requested => { assert.equal(requested, id); return { title: '<script>bad</script>', state: 'completed' } }, configuration: async () => ({ dataDir: dir }),
  })
  const server = http.createServer(route.handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}/bili-publisher/jobs/${id}/`, auth = { authorization: 'test' }
  assert.equal((await fetch(base)).status, 401)
  const html = await (await fetch(base, { headers: auth })).text(); assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;/)
  const media = await fetch(base + 'preview.mp4', { headers: { ...auth, range: 'bytes=2-4' } }); assert.equal(media.status, 206); assert.equal(await media.text(), '234')
  assert.equal(media.headers.get('content-range'), 'bytes 2-4/10')
  assert.equal((await fetch(base + 'input.json', { headers: auth })).status, 404)
  assert.equal((await fetch(base + 'preview.mp4', { method: 'HEAD', headers: auth })).headers.get('content-length'), '10')
  assert.equal((await fetch(base, { method: 'POST', headers: auth })).status, 405)
})
