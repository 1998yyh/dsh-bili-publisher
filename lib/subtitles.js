function time(seconds, ass = false) {
  let total = Math.round(seconds * (ass ? 100 : 1000))
  const scale = ass ? 100 : 1000
  const hours = Math.floor(total / (3600 * scale)); total %= 3600 * scale
  const minutes = Math.floor(total / (60 * scale)); total %= 60 * scale
  const whole = Math.floor(total / scale), fraction = total % scale
  const pad = n => String(n).padStart(2, '0')
  return `${ass ? hours : pad(hours)}:${pad(minutes)}:${pad(whole)}${ass ? '.' : ','}${String(fraction).padStart(ass ? 2 : 3, '0')}`
}

export function wrapText(text, length) {
  const chars = [...text]; const lines = []
  while (chars.length) lines.push(chars.splice(0, length).join(''))
  return lines
}

export function srt(cues) {
  return cues.map((cue, i) => `${i + 1}\n${time(cue.start)} --> ${time(cue.end)}\n${cue.text.replace(/\r/g, '')}\n`).join('\n')
}

export function ass(cues, { width, height, fontFamily = 'sans-serif' }) {
  if (!/^[^,\r\n{}\\]{1,80}$/.test(fontFamily)) throw Error('字幕字体名称不正确')
  const size = Math.round(width * 0.048)
  const lines = cues.map(cue => {
    const clean = cue.text.replace(/[{}\\]/g, c => ({ '{': '｛', '}': '｝', '\\': '＼' })[c]).replace(/[\r\n]/g, ' ')
    return `Dialogue: 0,${time(cue.start, true)},${time(cue.end, true)},Default,,0,0,0,,${wrapText(clean, 17).join('\\N')}`
  })
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${fontFamily},${size},&H00FFFFFF,&H00FFFFFF,&H00121720,&H80121720,0,0,0,0,100,100,0,0,3,2,0,2,36,36,${Math.round(height * 0.075)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join('\n')}\n`
}
