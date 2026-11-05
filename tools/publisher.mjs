#!/usr/bin/env node
import fs from 'node:fs/promises'
import { createService } from '../lib/service.js'

const args = process.argv.slice(2)
function flag(name) { const index = args.indexOf('--' + name); return index < 0 ? undefined : args[index + 1] }
const service = createService({ configFile: flag('config') })
const command = args[0]
try {
  let result
  if (command === 'status') result = await service.status()
  else if (command === 'prepare') result = await service.prepare(JSON.parse(await fs.readFile(flag('script'), 'utf8')))
  else if (command === 'render') {
    result = await service.render(flag('draft'), { retry: args.includes('--retry') })
    if (args.includes('--wait')) {
      while (['queued', 'running'].includes(result.state)) { await new Promise(resolve => setTimeout(resolve, 1000)); result = await service.getJob(result.id) }
      if (result.state !== 'completed') process.exitCode = 1
    }
  } else if (command === 'job') result = await service.getJob(flag('id'))
  else if (command === 'cancel') result = await service.cancel(flag('id'))
  else {
    console.log('用法：\n  publisher status [--config 配置文件]\n  publisher prepare --script 分镜.json [--config 配置文件]\n  publisher render --draft 草稿编号 [--wait] [--retry] [--config 配置文件]\n  publisher job --id 任务编号 [--config 配置文件]\n  publisher cancel --id 任务编号 [--config 配置文件]\n\n本版本制作视频预览，尚未接入 B 站发布。')
    if (command && command !== 'help') process.exitCode = 2
  }
  if (result) console.log(JSON.stringify(result, null, 2))
} catch (error) { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1 }
