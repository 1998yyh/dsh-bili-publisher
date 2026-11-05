import fs from 'node:fs/promises'
import { openSync, closeSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { loadConfig, providerReady, localMedia, endpoint, providerKey } from './config.js'
import { validateStoryboard, storyboardSummary } from './storyboard.js'
import { dependencies } from './process.js'
import { itemDir, readJson, saveJson, readJob } from './store.js'

const worker = fileURLToPath(new URL('../tools/render-worker.mjs', import.meta.url))

export function createService({ configFile } = {}) {
  const configuration = () => loadConfig(configFile)
  async function prepare(input) {
    const config = await configuration(), storyboard = validateStoryboard(input)
    for (const scene of storyboard.scenes) for (const key of ['imagePath', 'videoPath', 'audioPath']) if (scene[key]) await localMedia(scene[key], config)
    const id = randomUUID()
    await saveJson(path.join(itemDir(config, 'drafts', id), 'draft.json'), { id, createdAt: new Date().toISOString(), storyboard })
    return { draftId: id, ...storyboardSummary(storyboard), message: '草稿已准备；尚未调用生成或发布接口' }
  }
  async function status() {
    const config = await configuration()
    return { stage: 'video-preview', dependencies: await dependencies(config),
      image: { configured: providerReady(config.image), model: config.image.model || null },
      speech: { configured: config.speech.type === 'system-say' ? process.platform === 'darwin' : providerReady(config.speech), model: config.speech.model || null, type: config.speech.type || 'http' },
      capabilities: { storyboard: true, generatedImages: true, narratedVideo: true, existingImagesAndClips: true, bilibiliPublishing: false }, dataDir: config.dataDir }
  }
  async function getJob(id) {
    const config = await configuration(), job = await readJob(config, id), route = `bili-publisher/jobs/${id}/`
    return { ...job, previewUrl: config.publicBaseUrl ? new URL(route, config.publicBaseUrl.replace(/\/*$/, '/')).href : '/' + route }
  }
  async function render(draftId, { retry = false } = {}) {
    const config = await configuration(), draftDir = itemDir(config, 'drafts', draftId)
    const draft = await readJson(path.join(draftDir, 'draft.json'))
    const active = await readJson(path.join(draftDir, 'active.json')).catch(() => null)
    if (active) {
      const previous = await getJob(active.jobId)
      if (['queued', 'running', 'completed'].includes(previous.state) || !retry) return previous
      if (previous.state === 'interrupted') throw Error('上次制作意外中断；请重新准备草稿，原任务保留供排查')
    }
    const summary = storyboardSummary(draft.storyboard)
    if (summary.imageRequests) { endpoint(config.image, 'images/generations'); providerKey(config.image, '生图'); if (!config.image.model) throw Error('生图模型未配置') }
    if (summary.speechRequests) {
      if (config.speech.type === 'system-say') { if (process.platform !== 'darwin') throw Error('服务器需要配置配音服务；system-say 仅支持 macOS') }
      else { endpoint(config.speech, 'audio/speech'); providerKey(config.speech, '配音'); if (!config.speech.model || !config.speech.voice) throw Error('配音模型或 voice 未配置') }
    }
    const deps = await dependencies(config)
    if (!deps.ffmpeg.ok || !deps.ffprobe.ok) throw Error('请先安装并配置 ffmpeg 与 ffprobe')
    if (!deps.ffmpeg.filtersSupported || !deps.ffmpeg.h264Supported) throw Error('FFmpeg 需要支持 libx264、subtitles/libass、zoompan 和 tpad')
    try { await fs.mkdir(path.join(draftDir, 'render.lock')) } catch { throw Error('该草稿的制作任务正在启动或运行，请稍后查询') }
    const id = randomUUID(), directory = itemDir(config, 'jobs', id)
    let launched = false
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      await saveJson(path.join(directory, 'job.json'), { id, draftId, title: draft.storyboard.title, state: 'queued', stage: 'queued', createdAt: new Date().toISOString() })
      await saveJson(path.join(directory, 'input.json'), { config, storyboard: draft.storyboard })
      await saveJson(path.join(draftDir, 'active.json'), { jobId: id })
      const log = openSync(path.join(directory, 'worker.log'), 'a', 0o600)
      try {
        const child = spawn(config.node, [worker, config.dataDir, id], { detached: true, shell: false, stdio: ['ignore', log, log], windowsHide: true })
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(Error('制作进程无法启动，请检查 node 路径'))) })
        launched = true
        child.unref()
        await saveJson(path.join(directory, 'process.json'), { pid: child.pid })
      } finally { closeSync(log) }
    } catch (error) {
      if (launched) throw Error(`制作进程已启动但登记未完成，请先查询任务 ${id}，不要重复制作`)
      await saveJson(path.join(directory, 'job.json'), { id, draftId, title: draft.storyboard.title, state: 'failed', message: error.message, createdAt: new Date().toISOString() })
      await fs.rm(path.join(draftDir, 'render.lock'), { recursive: true, force: true }); throw error
    }
    return getJob(id)
  }
  async function cancel(id) {
    const config = await configuration(), job = await readJob(config, id)
    if (!['queued', 'running'].includes(job.state)) return job
    await fs.writeFile(path.join(itemDir(config, 'jobs', id), 'cancel.request'), '', { mode: 0o600 })
    return { ...job, message: '已请求取消，当前生成请求或编码过程会停止' }
  }
  return { configuration, prepare, render, getJob, status, cancel }
}
