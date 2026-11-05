import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const validId = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value || '')

export function itemDir(config, kind, id) {
  if (!['drafts', 'jobs'].includes(kind) || !validId(id)) throw Error('草稿或任务编号不正确')
  return path.join(config.dataDir, kind, id)
}

export async function saveJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = file + '.' + randomUUID() + '.tmp'
  try { await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await fs.rename(temp, file) }
  finally { await fs.rm(temp, { force: true }) }
}

export async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { throw Error('找不到记录或记录格式已损坏') }
}

export async function readJob(config, id) {
  const dir = itemDir(config, 'jobs', id)
  const state = await readJson(path.join(dir, 'job.json'))
  if (['queued', 'running'].includes(state.state)) {
    const processFile = await readJson(path.join(dir, 'process.json')).catch(() => null)
    if (processFile && Date.now() - Date.parse(state.createdAt) > 3000) {
      try { process.kill(processFile.pid, 0) }
      catch (e) { if (e.code === 'ESRCH') return { ...state, state: 'interrupted', message: '制作进程已退出；请重新准备草稿，原任务保留供排查' } }
    }
  }
  return state
}
