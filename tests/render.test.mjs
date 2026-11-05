import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import sharp from 'sharp'
import { createService } from '../lib/service.js'
import { run, probe } from '../lib/process.js'
import { renderStoryboard } from '../lib/render.js'
import plugin from '../lib/index.js'

const ffmpeg = process.env.FFMPEG || 'ffmpeg', ffprobe = process.env.FFPROBE || 'ffprobe'
const hasMedia = await run(ffmpeg, ['-version']).then(() => run(ffprobe, ['-version'])).then(() => true, () => false)

function wav(seconds) {
  const count = Math.round(seconds * 24000), buffer = Buffer.alloc(44 + count * 2)
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(24000, 24); buffer.writeUInt32LE(48000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(count * 2, 40)
  for (let i = 0; i < count; i++) buffer.writeInt16LE(Math.round(Math.sin(i * 440 * 2 * Math.PI / 24000) * 1000), 44 + i * 2)
  return buffer
}
async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'publisher-render-')); t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const config = { dataDir: dir, mediaRoots: [dir], ffmpeg, ffprobe, fontFamily: process.platform === 'darwin' ? 'PingFang SC' : 'Noto Sans CJK SC' }
  const file = path.join(dir, 'voice.wav'); await fs.writeFile(file, wav(0.4))
  const configFile = path.join(dir, 'config.json'); await fs.writeFile(configFile, JSON.stringify(config))
  return { dir, config, file, configFile }
}
test('DSH plugin registers callable preparation, rendering, status and cancellation tools', async t => {
  const { configFile } = await setup(t), tools = new Map()
  plugin.apply({ tools: { register(tool) { tools.set(tool.name, tool) } } }, { configFile })
  assert.equal(tools.size, 5)
  const tool = tools.get('bili_video_prepare')
  const value = JSON.parse(await tool.execute({ storyboard: JSON.stringify({ title: 'draft', visualMode: 'cards', scenes: [{ narration: 'hello' }] }) }))
  assert.ok(value.draftId)
  assert.equal(JSON.parse(await tool.execute({ storyboard: '{}' })).ok, false)
})

test('background worker renders actual AV, aligns duration, persists subtitles and avoids duplicate renders', { skip: !hasMedia, timeout: 120000 }, async t => {
  const { dir, file, configFile, config } = await setup(t), service = createService({ configFile })
  const draft = await service.prepare({ title: '实际合成测试', visualMode: 'cards', durationSeconds: 3, scenes: [{ heading: '一', narration: 'hello one', audioPath: file }, { heading: '二', narration: 'hello two', audioPath: file }] })
  const first = await service.render(draft.draftId), duplicate = await service.render(draft.draftId)
  assert.equal(first.id, duplicate.id)
  let result = first
  for (let n = 0; n < 180 && ['queued', 'running'].includes(result.state); n++) { await new Promise(resolve => setTimeout(resolve, 400)); result = await service.getJob(first.id) }
  assert.equal(result.state, 'completed', JSON.stringify(result))
  const media = await probe(result.result.videoPath, config)
  assert.ok(media.streams.some(s => s.codec_type === 'video' && s.width === 720 && s.height === 1280))
  assert.ok(media.streams.some(s => s.codec_type === 'audio')); assert.ok(Math.abs(media.duration - 3) < 0.15)
  assert.match(await fs.readFile(result.result.subtitlePath, 'utf8'), /hello one/)
  assert.equal((await service.render(draft.draftId)).id, first.id)
  assert.equal((await fs.readdir(path.join(dir, 'jobs'))).length, 1)
})

test('existing video clips can be trimmed and rendered with replacement narration', { skip: !hasMedia, timeout: 120000 }, async t => {
  const { dir, file, config } = await setup(t), clip = path.join(dir, 'clip.mp4')
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x240:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip])
  const output = await renderStoryboard({ title: 'clip', orientation: 'portrait', durationSeconds: 3, visualMode: 'generated', scenes: [{ narration: 'clip caption', videoPath: clip, startSeconds: 0.2, audioPath: file }] }, config, path.join(dir, 'result'))
  assert.ok(output.videoPath.endsWith('preview.mp4'))
  assert.ok(Math.abs(output.durationSeconds - 3) < 0.15)
})

test('overlong speech fails explicitly and cancelled work does not make an output', { skip: !hasMedia, timeout: 60000 }, async t => {
  const { dir, file, config } = await setup(t)
  await fs.writeFile(file, wav(4))
  const board = { title: 'long', orientation: 'portrait', durationSeconds: 3, visualMode: 'cards', scenes: [{ heading: 'long', narration: 'long speech', audioPath: file }] }
  await assert.rejects(renderStoryboard(board, config, path.join(dir, 'long')), /配音总时长/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(renderStoryboard(board, config, path.join(dir, 'cancel'), { signal: controller.signal }))
  await assert.rejects(fs.access(path.join(dir, 'cancel', 'preview.mp4')))
})

test('zero-input generation runs through HTTP adapters, worker and FFmpeg without persisting API keys', { skip: !hasMedia, timeout: 120000 }, async t => {
  const { dir, config, configFile } = await setup(t)
  const image = await sharp({ create: { width: 360, height: 640, channels: 3, background: '#135266' } }).png().toBuffer()
  const calls = []
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    const input = JSON.parse(body); calls.push({ url: req.url, input })
    assert.equal(req.headers.authorization, 'Bearer test-worker-secret')
    if (req.url === '/v1/images/generations') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ b64_json: image.toString('base64') }] })) }
    else { assert.equal(input.response_format, 'wav'); res.setHeader('Content-Type', 'audio/wav'); res.end(wav(0.25)) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  process.env.PUBLISHER_WORKER_TEST_KEY = 'test-worker-secret'; t.after(() => { delete process.env.PUBLISHER_WORKER_TEST_KEY })
  const provider = { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture-model', apiKeyEnv: 'PUBLISHER_WORKER_TEST_KEY', voice: 'fixture-voice' }
  await fs.writeFile(configFile, JSON.stringify({ ...config, image: { ...provider, apiKey: 'ignored-secret-field' }, speech: provider }))
  const service = createService({ configFile }), draft = await service.prepare({ title: 'generated', durationSeconds: 3, scenes: [{ heading: '画面', imagePrompt: 'test illustration', narration: '一句。再一句。' }] })
  assert.equal(calls.length, 0)
  let job = await service.render(draft.draftId)
  for (let n = 0; n < 150 && ['queued', 'running'].includes(job.state); n++) { await new Promise(resolve => setTimeout(resolve, 400)); job = await service.getJob(job.id) }
  assert.equal(job.state, 'completed', JSON.stringify(job)); assert.equal(job.result.speechAlignment, 'per-utterance')
  assert.equal(calls.filter(c => c.url.endsWith('images/generations')).length, 1)
  assert.equal(calls.filter(c => c.url.endsWith('audio/speech')).length, 2)
  const stored = await fs.readFile(path.join(dir, 'jobs', job.id, 'input.json'), 'utf8')
  assert.doesNotMatch(stored, /test-worker-secret|ignored-secret-field/)
  const subtitle = await fs.readFile(job.result.subtitlePath, 'utf8'); assert.match(subtitle, /一句。/); assert.match(subtitle, /再一句。/)
})
