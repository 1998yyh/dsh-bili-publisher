import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { validateStoryboard, narrationChunks } from '../lib/storyboard.js'
import { createService } from '../lib/service.js'
import { localMedia, endpoint } from '../lib/config.js'
import { generateImage, generateSpeech } from '../lib/providers.js'
import { ass, srt } from '../lib/subtitles.js'

const board = { title: '小鱼的一天', visualMode: 'cards', durationSeconds: 30, scenes: [{ heading: '出发', narration: '今天先翻一个身。然后认真做一条视频。' }] }

test('storyboards validate before any generation and preserve unicode narration', () => {
  assert.equal(validateStoryboard(board).scenes.length, 1)
  assert.throws(() => validateStoryboard({ ...board, durationSeconds: Infinity }))
  assert.throws(() => validateStoryboard({ ...board, scenes: [] }))
  assert.throws(() => validateStoryboard({ ...board, visualMode: 'generated' }), /imagePrompt/)
  assert.throws(() => validateStoryboard({ ...board, scenes: [{ narration: 'x', imagePath: '/a', videoPath: '/b' }] }))
  const original = '这是一段很长的旁白，用来检查字幕切分是否保留所有文字和标点。还有🐟。'
  assert.equal(narrationChunks(original).join(''), original)
  assert.ok(narrationChunks(original).every(chunk => [...chunk].length <= 22))
})

test('prepare is local only, counts requests and never stores environment keys', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'publisher-prepare-')); t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const configFile = path.join(dir, 'config.json')
  await fs.writeFile(configFile, JSON.stringify({ dataDir: dir, speech: { apiKeyEnv: 'PUBLISHER_TEST_KEY' } }))
  process.env.PUBLISHER_TEST_KEY = 'fixture-secret-never-persist'
  t.after(() => { delete process.env.PUBLISHER_TEST_KEY })
  const service = createService({ configFile }), draft = await service.prepare(board)
  assert.equal(draft.imageRequests, 0); assert.equal(draft.speechRequests, 2)
  const stored = await fs.readFile(path.join(dir, 'drafts', draft.draftId, 'draft.json'), 'utf8')
  assert.doesNotMatch(stored, /fixture-secret/)
  await assert.rejects(service.render(draft.draftId), /服务|密钥|模型/)
  await assert.rejects(fs.access(path.join(dir, 'jobs')))
})

test('media roots reject traversal and symbolic links outside configured directories', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'publisher-roots-')); t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const root = path.join(dir, 'media'); await fs.mkdir(root)
  await fs.writeFile(path.join(dir, 'private'), 'private')
  await fs.symlink(path.join(dir, 'private'), path.join(root, 'leak'))
  await assert.rejects(localMedia(path.join(root, 'leak'), { dataDir: root, mediaRoots: [] }), /mediaRoots/)
  await assert.rejects(localMedia('../private', { dataDir: root, mediaRoots: [] }), /绝对/)
  await fs.writeFile(path.join(root, 'ok'), 'media')
  assert.equal(await localMedia(path.join(root, 'ok'), { dataDir: root, mediaRoots: [] }), await fs.realpath(path.join(root, 'ok')))
})

test('generation adapters enforce protocol, request fields, response formats and redacted failures', async t => {
  process.env.PUBLISHER_ADAPTER_KEY = 'fixture-api-secret'
  t.after(() => { delete process.env.PUBLISHER_ADAPTER_KEY })
  const provider = { baseUrl: 'https://provider.example/v1', model: 'configured-model', apiKeyEnv: 'PUBLISHER_ADAPTER_KEY', voice: 'configured-voice', parameters: { prompt: 'override', model: 'wrong', input: 'override', response_format: 'pcm' } }
  assert.throws(() => endpoint({ baseUrl: 'http://external.example' }, 'audio/speech'), /HTTPS/)
  assert.throws(() => endpoint({ baseUrl: 'https://user:secret@example.org' }, 'audio/speech'), /凭据/)
  const fetcher = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer fixture-api-secret'); assert.equal(options.redirect, 'error')
    const body = JSON.parse(options.body); assert.equal(body.model, 'configured-model')
    if (url.endsWith('images/generations')) { assert.equal(body.prompt, 'actual prompt'); assert.equal(body.n, 1); return Response.json({ data: [{ b64_json: Buffer.from('image bytes').toString('base64') }] }) }
    assert.equal(body.input, 'actual narration'); assert.equal(body.response_format, 'wav'); return new Response('audio bytes', { headers: { 'Content-Type': 'audio/wav' } })
  }
  assert.equal((await generateImage('actual prompt', provider, { fetcher })).toString(), 'image bytes')
  assert.equal((await generateSpeech('actual narration', provider, { fetcher })).toString(), 'audio bytes')
  await assert.rejects(generateImage('prompt', provider, { fetcher: async () => new Response('fixture-api-secret', { status: 401 }) }), error => !error.message.includes('fixture-api-secret') && /401/.test(error.message))
  await assert.rejects(generateImage('prompt', provider, { fetcher: async () => Response.json({ data: [{ url: 'http://127.0.0.1/secret' }] }) }), /b64_json/)
})

test('subtitle times carry across minutes and escape ASS control sequences', () => {
  const cues = [{ text: '{\\pos(0,0)}测试', start: 59.9999, end: 62.125 }]
  assert.match(srt(cues), /00:01:00,000 --> 00:01:02,125/)
  const output = ass(cues, { width: 720, height: 1280 })
  assert.doesNotMatch(output, /\{\\pos/); assert.match(output, /0:01:00.00,0:01:02.13/)
})
