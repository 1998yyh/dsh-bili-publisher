const text = (value, name, max) => {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw Error(`${name}需要是 1–${max} 字的文本`)
  return value.trim()
}

export function validateStoryboard(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('分镜需要是 JSON 对象')
  const title = text(input.title, '标题', 80)
  const orientation = input.orientation || 'portrait'
  if (!['portrait', 'landscape'].includes(orientation)) throw Error('orientation 只能是 portrait 或 landscape')
  const visualMode = input.visualMode || 'generated'
  if (!['generated', 'cards'].includes(visualMode)) throw Error('visualMode 只能是 generated 或 cards')
  const durationSeconds = input.durationSeconds ?? 60
  if (!Number.isFinite(durationSeconds) || durationSeconds < 3 || durationSeconds > 120) throw Error('目标时长需要在 3–120 秒之间')
  if (!Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > 12) throw Error('需要 1–12 段分镜')
  const scenes = input.scenes.map((scene, index) => {
    const label = `第 ${index + 1} 段`
    if (!scene || typeof scene !== 'object') throw Error(`${label}格式不正确`)
    if (scene.imagePath && scene.videoPath) throw Error(`${label}只能指定一种画面素材`)
    const narration = text(scene.narration, `${label}旁白`, 240)
    const imagePrompt = scene.imagePrompt ? text(scene.imagePrompt, `${label}画面描述`, 2000) : ''
    if (visualMode === 'generated' && !scene.imagePath && !scene.videoPath && !imagePrompt) throw Error(`${label}需要 imagePrompt 或已有画面素材`)
    const startSeconds = scene.startSeconds ?? 0
    if (!Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds > 86400) throw Error(`${label}素材起点不正确`)
    for (const key of ['imagePath', 'videoPath', 'audioPath']) if (scene[key] !== undefined && typeof scene[key] !== 'string') throw Error(`${label}${key}需要是文件路径`)
    return { heading: scene.heading ? text(scene.heading, `${label}小标题`, 36) : `第 ${index + 1} 幕`, narration, imagePrompt, startSeconds,
      ...(scene.imagePath ? { imagePath: scene.imagePath } : {}), ...(scene.videoPath ? { videoPath: scene.videoPath } : {}), ...(scene.audioPath ? { audioPath: scene.audioPath } : {}) }
  })
  return { title, orientation, visualMode, durationSeconds, style: input.style ? text(input.style, '统一画面风格', 1200) : '', scenes }
}

export function narrationChunks(value, maximum = 22) {
  const sentences = value.match(/[^。！？!?；;\n]+[。！？!?；;]?/gu) || [value]
  const chunks = []
  for (const sentence of sentences) {
    let pending = [...sentence.trim()]
    while (pending.length) {
      let length = Math.min(maximum, pending.length)
      if (length < pending.length) {
        const punctuation = pending.slice(0, length).findLastIndex(c => /[，,、：: ]/.test(c))
        if (punctuation >= maximum / 2) length = punctuation + 1
      }
      const chunk = pending.splice(0, length).join('').trim()
      if (chunk) chunks.push(chunk)
    }
  }
  return chunks
}

export function storyboardSummary(storyboard) {
  return { title: storyboard.title, visualMode: storyboard.visualMode, durationSeconds: storyboard.durationSeconds, sceneCount: storyboard.scenes.length,
    imageRequests: storyboard.scenes.filter(s => storyboard.visualMode === 'generated' && !s.imagePath && !s.videoPath).length,
    speechRequests: storyboard.scenes.reduce((n, s) => n + (s.audioPath ? 0 : narrationChunks(s.narration).length), 0),
    narrationCharacters: storyboard.scenes.reduce((n, s) => n + [...s.narration].length, 0),
    scenes: storyboard.scenes.map(({ heading, narration, imagePrompt }) => ({ heading, narration, imagePrompt })) }
}
