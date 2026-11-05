import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export function configPath() {
  return process.env.BILI_PUBLISHER_CONFIG || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'bili-publisher.config.json')
}

export async function loadConfig(file = configPath()) {
  let raw = {}
  try { raw = JSON.parse(await fs.readFile(file, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw Error('发布插件配置无法读取，请检查 JSON 格式') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('发布插件配置需要是 JSON 对象')
  const provider = (input = {}, type) => {
    const result = Object.fromEntries(['type', 'baseUrl', 'model', 'apiKeyEnv', 'size', 'voice'].filter(k => typeof input[k] === 'string').map(k => [k, input[k]]))
    const allowed = type === 'image' ? ['quality', 'output_format', 'background', 'response_format', 'moderation'] : ['speed', 'instructions']
    result.parameters = Object.fromEntries(allowed.filter(k => input.parameters?.[k] !== undefined).map(k => [k, input.parameters[k]]))
    return result
  }
  const dataDir = path.resolve(raw.dataDir || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'bili-publisher'))
  return {
    dataDir, configFile: path.resolve(file),
    ffmpeg: raw.ffmpeg || process.env.FFMPEG || 'ffmpeg',
    ffprobe: raw.ffprobe || process.env.FFPROBE || 'ffprobe',
    node: raw.node || process.env.DSH_NODE || (process.versions.electron ? 'node' : process.execPath),
    publicBaseUrl: raw.publicBaseUrl || '',
    mediaRoots: (raw.mediaRoots || [dataDir]).map(p => path.resolve(p)),
    fontFamily: raw.fontFamily || 'sans-serif',
    image: provider(raw.image, 'image'), speech: provider(raw.speech, 'speech'),
  }
}

export function endpoint(provider, suffix) {
  let url
  try { url = new URL(provider.baseUrl.replace(/\/+$/, '') + '/' + suffix) } catch { throw Error('请配置完整的服务 baseUrl，例如 https://服务地址/v1') }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw Error('服务地址需要 HTTPS；本地服务可使用 HTTP')
  if (url.username || url.password || url.search || url.hash) throw Error('服务地址中不能包含凭据、查询参数或片段')
  return url.href
}

export function providerKey(provider, label) {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(provider.apiKeyEnv || '')) throw Error(`${label}需要配置 apiKeyEnv 环境变量名`)
  const value = process.env[provider.apiKeyEnv]
  if (!value?.trim()) throw Error(`${label}密钥环境变量未设置：${provider.apiKeyEnv}`)
  return value.trim()
}

export function providerReady(provider) {
  return !!(provider.model && provider.baseUrl && provider.apiKeyEnv && process.env[provider.apiKeyEnv]?.trim())
}

export async function localMedia(file, config) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw Error('素材需要是服务器上的绝对文件路径')
  const real = await fs.realpath(file)
  const roots = await Promise.all([config.dataDir, ...config.mediaRoots].map(p => fs.realpath(p).catch(() => path.resolve(p))))
  if (!roots.some(root => { const relative = path.relative(root, real); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) })) throw Error('素材不在已配置的 mediaRoots 中')
  const stat = await fs.stat(real)
  if (!stat.isFile() || stat.size === 0) throw Error('素材文件为空或不是普通文件')
  return real
}
