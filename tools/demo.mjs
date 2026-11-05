#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createService } from '../lib/service.js'

if (process.platform !== 'darwin') throw Error('此离线演示使用 macOS 系统配音；Linux 请配置配音接口后运行 publisher 命令')
const index = process.argv.indexOf('--output')
const directory = path.resolve(index >= 0 ? process.argv[index + 1] : path.join(os.tmpdir(), 'dsh-bili-publisher-demo'))
await fs.mkdir(directory, { recursive: true, mode: 0o700 })
const configFile = path.join(directory, 'config.json')
await fs.writeFile(configFile, JSON.stringify({ dataDir: directory, ffmpeg: process.env.FFMPEG || 'ffmpeg', ffprobe: process.env.FFPROBE || 'ffprobe', fontFamily: 'PingFang SC', speech: { type: 'system-say', voice: 'Tingting' } }, null, 2))
const storyboard = JSON.parse(await fs.readFile(fileURLToPath(new URL('../examples/storyboard.json', import.meta.url)), 'utf8'))
storyboard.visualMode = 'cards'
storyboard.durationSeconds = 30
const service = createService({ configFile }), draft = await service.prepare(storyboard)
let job = await service.render(draft.draftId)
console.log(JSON.stringify({ jobId: job.id, demo: '文字卡片 + macOS 本地配音，未调用生图或付费服务' }))
let last = ''
while (['queued', 'running'].includes(job.state)) {
  const stage = `${job.stage} ${job.scene || 0}/${job.sceneCount || storyboard.scenes.length}`
  if (stage !== last) { console.log(stage); last = stage }
  await new Promise(resolve => setTimeout(resolve, 1000)); job = await service.getJob(job.id)
}
console.log(JSON.stringify(job, null, 2))
if (job.state !== 'completed') process.exitCode = 1
