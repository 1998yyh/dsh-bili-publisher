import fs from 'node:fs/promises'
import path from 'node:path'
import { readJson, saveJson, itemDir } from '../lib/store.js'
import { renderStoryboard } from '../lib/render.js'

const [dataDir, id] = process.argv.slice(2)
const directory = itemDir({ dataDir }, 'jobs', id)
const { config, storyboard } = await readJson(path.join(directory, 'input.json'))
let state = await readJson(path.join(directory, 'job.json'))
const controller = new AbortController()
let polling = false
async function checkCancelled() {
  if (polling) return
  polling = true
  try { await fs.access(path.join(directory, 'cancel.request')); controller.abort() } catch {} finally { polling = false }
}
const timer = setInterval(checkCancelled, 500)
try {
  await checkCancelled(); controller.signal.throwIfAborted()
  state = { ...state, state: 'running', startedAt: new Date().toISOString() }
  await saveJson(path.join(directory, 'job.json'), state)
  const result = await renderStoryboard(storyboard, config, directory, { signal: controller.signal, progress: async progress => {
    state = { ...state, ...progress, updatedAt: new Date().toISOString() }; await saveJson(path.join(directory, 'job.json'), state)
  } })
  await saveJson(path.join(directory, 'job.json'), { ...state, state: 'completed', stage: 'completed', completedAt: new Date().toISOString(), result })
} catch (error) {
  await saveJson(path.join(directory, 'job.json'), { ...state, state: controller.signal.aborted ? 'cancelled' : 'failed', message: controller.signal.aborted ? '制作已取消' : error.message, completedAt: new Date().toISOString() }); process.exitCode = 1
} finally {
  clearInterval(timer)
  await fs.rm(path.join(itemDir(config, 'drafts', state.draftId), 'render.lock'), { recursive: true, force: true })
}
