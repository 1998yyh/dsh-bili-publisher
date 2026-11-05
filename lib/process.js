import { spawn } from 'node:child_process'

export function run(executable, args, { cwd, signal, timeoutMs = 180000, limit = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const timeout = AbortSignal.timeout(timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    let child
    try { child = spawn(executable, args, { cwd, signal: combined, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch { reject(Error('无法启动媒体工具，请检查依赖路径')); return }
    const chunks = []; let size = 0
    child.stdout.on('data', chunk => { size += chunk.length; if (size <= limit) chunks.push(chunk); else child.kill() })
    // FFmpeg diagnostics can include filesystem paths. Return a bounded generic
    // error to the model; callers validate inputs separately.
    let diagnostic = ''
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-4096) })
    child.once('error', error => reject(Error(error.code === 'ENOENT' ? '找不到媒体工具，请配置 ffmpeg / ffprobe / node 路径' : combined.aborted ? '媒体任务已取消或超时' : '媒体工具启动失败')))
    child.once('close', code => {
      if (combined.aborted) reject(Error('媒体任务已取消或超时'))
      else if (size > limit) reject(Error('媒体工具输出超过大小限制'))
      else if (code !== 0) {
        const hint = /No such filter.*subtitles|not found.*libass/i.test(diagnostic) ? '，需要支持 libass 字幕的 FFmpeg' : ''
        reject(Error(`媒体工具执行失败（退出码 ${code}）${hint}`))
      } else resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })
}

export async function probe(file, config, signal) {
  const text = await run(config.ffprobe, ['-protocol_whitelist', 'file,pipe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], { signal })
  let value
  try { value = JSON.parse(text) } catch { throw Error('无法解析媒体信息') }
  const duration = Number(value.format?.duration)
  return { duration, streams: value.streams || [] }
}

export async function dependencies(config) {
  const results = await Promise.allSettled([run(config.ffmpeg, ['-version']), run(config.ffprobe, ['-version']), run(config.ffmpeg, ['-hide_banner', '-filters']), run(config.ffmpeg, ['-hide_banner', '-encoders'])])
  const result = Object.fromEntries(results.slice(0, 2).map((r, index) => [index === 0 ? 'ffmpeg' : 'ffprobe', r.status === 'fulfilled' ? { ok: true, version: r.value.split('\n')[0] } : { ok: false, error: r.reason.message }]))
  result.ffmpeg.filtersSupported = results[2].status === 'fulfilled' && ['subtitles', 'zoompan', 'tpad'].every(name => new RegExp('\\b' + name + '\\s').test(results[2].value))
  result.ffmpeg.h264Supported = results[3].status === 'fulfilled' && /\blibx264\s/.test(results[3].value)
  return result
}
