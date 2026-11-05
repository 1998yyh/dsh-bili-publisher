import sharp from 'sharp'
import { wrapText } from './subtitles.js'

export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export async function createCard(scene, index, { width, height, fontFamily }, output) {
  const title = wrapText(scene.heading, 11).slice(0, 3)
  const label = String(index + 1).padStart(2, '0')
  const font = escapeHtml(fontFamily)
  // Programmatically drawn title cards. This is deliberately identified as
  // cards mode, never reported as an AI-generated illustration.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 720 1280">
    <defs><linearGradient id="sea" x2="1" y2="1"><stop stop-color="#102b3c"/><stop offset="1" stop-color="#06131d"/></linearGradient></defs>
    <rect width="720" height="1280" fill="url(#sea)"/>
    <circle cx="640" cy="220" r="230" fill="#3a9da4" opacity=".09"/><circle cx="70" cy="950" r="260" fill="#e9a487" opacity=".06"/>
    <g fill="none" stroke="#7db4bb" opacity=".12"><path d="M-50 480 Q180 400 370 470 T800 450"/><path d="M-50 500 Q180 420 370 490 T800 470"/></g>
    <text x="64" y="112" fill="#a2c5ca" font-size="20" letter-spacing="5" font-family="${font}">LITTLE WHALE · VIDEO NOTES</text>
    <text x="64" y="218" fill="#e9a487" font-size="30" font-family="${font}">${label} / 小鲸鱼的片刻</text>
    ${title.map((line, i) => `<text x="62" y="${338 + i * 78}" fill="#f3eee7" font-size="58" font-weight="600" font-family="${font}">${escapeHtml(line)}</text>`).join('')}
    <g transform="translate(176 658)"><ellipse cx="174" cy="87" rx="153" ry="81" fill="#81b7bc"/><path d="M42 78 Q-20 35 -46 76 Q-20 119 42 102" fill="#81b7bc"/><path d="M220 142 Q249 194 279 143" fill="#5d939c"/><circle cx="274" cy="69" r="7" fill="#102b3c"/><path d="M279 97 Q294 110 307 94" fill="none" stroke="#102b3c" stroke-width="4" stroke-linecap="round"/><circle cx="306" cy="22" r="9" fill="none" stroke="#81b7bc" stroke-width="3"/><circle cx="332" cy="-13" r="5" fill="#81b7bc"/></g>
    <rect x="64" y="1024" width="46" height="3" rx="1.5" fill="#e9a487"/>
    <text x="64" y="1072" fill="#8dabb4" font-size="20" font-family="${font}">配音与字幕 · 原创视频预览</text>
  </svg>`
  await sharp(Buffer.from(svg), { limitInputPixels: 40_000_000 }).png().toFile(output)
}
