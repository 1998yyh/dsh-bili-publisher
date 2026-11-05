import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { localMedia } from './config.js'
import { run, probe } from './process.js'
import { generateImage, generateSpeech } from './providers.js'
import { narrationChunks } from './storyboard.js'
import { ass, srt } from './subtitles.js'
import { createCard, escapeHtml } from './cards.js'

const FPS = 24
const ffmpeg = (config, args, options) => run(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], options)

async function speechFile(text, target, provider, signal) {
  if (provider.type === 'system-say') {
    if (process.platform !== 'darwin') throw Error('system-say 仅供 macOS 本地演示；服务器需要配置配音服务')
    await fs.writeFile(target + '.txt', text)
    await run('/usr/bin/say', ['-v', provider.voice || 'Tingting', '-o', target, '--file-format=AIFF', '-f', target + '.txt'], { signal })
  } else await fs.writeFile(target, await generateSpeech(text, provider, { signal }))
}

export async function renderStoryboard(storyboard, config, directory, { signal, progress = async () => {} } = {}) {
  const dimensions = storyboard.orientation === 'portrait' ? { width: 720, height: 1280 } : { width: 1280, height: 720 }
  const { width, height } = dimensions
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const prepared = []
  for (const [index, scene] of storyboard.scenes.entries()) {
    signal?.throwIfAborted()
    await progress({ stage: 'assets', scene: index + 1, sceneCount: storyboard.scenes.length })
    const sceneDir = path.join(directory, `scene-${String(index).padStart(2, '0')}`)
    await fs.mkdir(sceneDir, { recursive: true })
    let visual = 'image'
    if (scene.videoPath) {
      const input = await localMedia(scene.videoPath, config)
      await fs.copyFile(input, path.join(sceneDir, 'source-video'))
      const info = await probe(path.join(sceneDir, 'source-video'), config, signal)
      if (!info.streams.some(s => s.codec_type === 'video') || !Number.isFinite(info.duration) || scene.startSeconds >= info.duration) throw Error(`第 ${index + 1} 段视频素材无法读取或起点超出时长`)
      visual = 'video'
    } else if (scene.imagePath || storyboard.visualMode === 'generated') {
      const input = scene.imagePath ? await fs.readFile(await localMedia(scene.imagePath, config)) : await generateImage([storyboard.style, scene.imagePrompt].filter(Boolean).join('\n'), config.image, { signal })
      try { await sharp(input, { limitInputPixels: 40_000_000 }).rotate().resize(width * 2, height * 2, { fit: 'cover' }).png().toFile(path.join(sceneDir, 'visual.png')) }
      catch { throw Error(`第 ${index + 1} 段图片无法解码`) }
    } else await createCard(scene, index, { ...dimensions, fontFamily: config.fontFamily }, path.join(sceneDir, 'visual.png'))

    const chunks = scene.audioPath ? [scene.narration] : narrationChunks(scene.narration)
    const cues = []; let duration = 0
    for (const [part, text] of chunks.entries()) {
      signal?.throwIfAborted()
      await progress({ stage: 'speech', scene: index + 1, sceneCount: storyboard.scenes.length, part: part + 1, parts: chunks.length })
      const raw = path.join(sceneDir, `raw-${part}.audio`), normalized = path.join(sceneDir, `voice-${part}.wav`)
      if (scene.audioPath) await fs.copyFile(await localMedia(scene.audioPath, config), raw)
      else await speechFile(text, raw, config.speech, signal)
      await ffmpeg(config, ['-protocol_whitelist', 'file,pipe', '-i', raw, '-vn', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', normalized], { signal })
      const audio = await probe(normalized, config, signal)
      if (!audio.streams.some(s => s.codec_type === 'audio') || !Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > 120) throw Error('配音时长不正确')
      cues.push({ text, start: duration, end: duration + audio.duration }); duration += audio.duration
    }
    await fs.writeFile(path.join(sceneDir, 'voices.txt'), chunks.map((_, part) => `file 'voice-${part}.wav'`).join('\n'))
    await ffmpeg(config, ['-f', 'concat', '-safe', '1', '-i', 'voices.txt', '-c:a', 'pcm_s16le', 'narration.wav'], { cwd: sceneDir, signal })
    prepared.push({ sceneDir, scene, duration, cues, visual })
  }

  const targetFrames = Math.round(storyboard.durationSeconds * FPS)
  const minimumFrames = prepared.map(s => Math.ceil(s.duration * FPS))
  const spare = targetFrames - minimumFrames.reduce((a, b) => a + b, 0)
  if (spare < 0) throw Error(`配音总时长超过目标 ${storyboard.durationSeconds} 秒；请缩短旁白或增加目标时长`)
  const warnings = []
  if (spare / FPS > storyboard.durationSeconds * 0.35) warnings.push('配音较短，成片留白较多；可增加旁白或缩短目标时长')
  const allCues = []; let offset = 0
  for (const [index, item] of prepared.entries()) {
    signal?.throwIfAborted()
    await progress({ stage: 'render', scene: index + 1, sceneCount: prepared.length })
    const frames = minimumFrames[index] + Math.floor(spare / prepared.length) + (index < spare % prepared.length ? 1 : 0)
    const duration = frames / FPS
    const cueOptions = { ...dimensions, fontFamily: config.fontFamily }
    await fs.writeFile(path.join(item.sceneDir, 'subtitles.ass'), ass(item.cues, cueOptions))
    const base = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`
    const motion = item.visual === 'image' ? `,zoompan=z='1+0.04*on/${frames}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${width}x${height}:fps=${FPS}` : `,fps=${FPS},tpad=stop_mode=clone:stop_duration=120`
    const input = item.visual === 'video' ? ['-protocol_whitelist', 'file,pipe', '-ss', String(item.scene.startSeconds), '-i', 'source-video'] : ['-loop', '1', '-framerate', String(FPS), '-i', 'visual.png']
    await ffmpeg(config, [...input, '-i', 'narration.wav', '-map', '0:v:0', '-map', '1:a:0', '-vf', base + motion + ',subtitles=subtitles.ass', '-af', 'apad', '-t', String(duration),
      '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-threads', '2', '-c:a', 'aac', '-ar', '48000', '-ac', '1', '-b:a', '128k', 'segment.mp4'], { cwd: item.sceneDir, signal, timeoutMs: 600000 })
    allCues.push(...item.cues.map(c => ({ ...c, start: c.start + offset, end: c.end + offset })))
    offset += duration
  }
  await progress({ stage: 'finalize', scene: prepared.length, sceneCount: prepared.length })
  await fs.writeFile(path.join(directory, 'segments.txt'), prepared.map((_, i) => `file 'scene-${String(i).padStart(2, '0')}/segment.mp4'`).join('\n'))
  await ffmpeg(config, ['-f', 'concat', '-safe', '1', '-i', 'segments.txt', '-c', 'copy', '-t', String(storyboard.durationSeconds), '-movflags', '+faststart', 'preview.mp4'], { cwd: directory, signal })
  await ffmpeg(config, ['-i', 'preview.mp4', '-frames:v', '1', '-q:v', '2', 'poster.jpg'], { cwd: directory, signal })
  await fs.writeFile(path.join(directory, 'subtitles.srt'), srt(allCues))
  const result = await probe(path.join(directory, 'preview.mp4'), config, signal)
  if (!result.streams.some(s => s.codec_type === 'audio') || !result.streams.some(s => s.codec_type === 'video')) throw Error('成片缺少画面或音轨')
  await fs.writeFile(path.join(directory, 'preview.html'), previewHtml({ title: storyboard.title, state: 'completed' }))
  return { durationSeconds: result.duration, width, height, visualMode: storyboard.visualMode, warnings, videoPath: path.join(directory, 'preview.mp4'), posterPath: path.join(directory, 'poster.jpg'), subtitlePath: path.join(directory, 'subtitles.srt'), previewPath: path.join(directory, 'preview.html'), speechAlignment: storyboard.scenes.some(s => s.audioPath) ? 'provided-audio-per-scene' : 'per-utterance' }
}

export function previewHtml(job) {
  const title = escapeHtml(job.title || '视频制作预览')
  const ready = job.state === 'completed'
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${['queued', 'running'].includes(job.state) ? '<meta http-equiv="refresh" content="4">' : ''}<title>${title}</title><style>body{margin:0;background:#101b24;color:#ecf0f1;font:16px system-ui,sans-serif}main{max-width:800px;margin:40px auto;padding:24px}h1{font-size:26px}video{display:block;max-height:72vh;width:100%;background:#06131d;border-radius:12px}p{color:#b5c5cc;line-height:1.8}a{color:#8ecbd0}</style><main><h1>${title}</h1><p>视频制作预览 · 尚未发布到 B 站</p>${ready ? '<video controls playsinline preload="metadata" poster="poster.jpg" src="preview.mp4"></video><p><a href="preview.mp4" download>下载视频</a> · <a href="subtitles.srt" download>下载字幕</a></p>' : `<p>状态：${escapeHtml(job.state)} · ${escapeHtml(job.stage || job.message || '')}</p>`}</main></html>`
}
