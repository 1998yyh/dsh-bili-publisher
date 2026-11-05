import { endpoint, providerKey } from './config.js'

async function bodyLimited(response, maximum) {
  if (Number(response.headers.get('content-length') || 0) > maximum) throw Error('生成结果超过大小限制')
  const chunks = []; let size = 0
  for await (const chunk of response.body || []) {
    size += chunk.length
    if (size > maximum) throw Error('生成结果超过大小限制')
    chunks.push(Buffer.from(chunk))
  }
  if (!size) throw Error('生成服务返回了空结果')
  return Buffer.concat(chunks)
}

async function request(provider, suffix, body, label, signal, fetcher) {
  if (!provider.model?.trim()) throw Error(`${label}需要配置模型名称`)
  const key = providerKey(provider, label)
  const timeout = AbortSignal.timeout(180000)
  let response
  try {
    response = await fetcher(endpoint(provider, suffix), { method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch { throw Error(`${label}请求失败或已取消；本次不会自动重试`) }
  if (!response.ok) throw Error(`${label}失败（HTTP ${response.status}）；请检查服务配置、权限或额度`)
  return response
}

export async function generateImage(prompt, provider, { signal, fetcher = globalThis.fetch } = {}) {
  const response = await request(provider, 'images/generations', { ...provider.parameters, model: provider.model, prompt, n: 1, size: provider.size || '1024x1536' }, '生图', signal, fetcher)
  let data
  try { data = JSON.parse((await bodyLimited(response, 48 * 1024 * 1024)).toString()) } catch { throw Error('生图返回内容无法解析或过大') }
  const encoded = data.data?.[0]?.b64_json
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(encoded)) throw Error('当前生图适配器需要 data[0].b64_json 格式的图片结果')
  const result = Buffer.from(encoded, 'base64')
  if (!result.length || result.length > 32 * 1024 * 1024) throw Error('生成图片为空或超过大小限制')
  return result
}

export async function generateSpeech(input, provider, { signal, fetcher = globalThis.fetch } = {}) {
  if (!provider.voice?.trim()) throw Error('配音需要配置 voice')
  const response = await request(provider, 'audio/speech', { ...provider.parameters, model: provider.model, voice: provider.voice, input, response_format: 'wav' }, '配音', signal, fetcher)
  if ((response.headers.get('content-type') || '').includes('json')) throw Error('配音接口未返回音频')
  return bodyLimited(response, 32 * 1024 * 1024)
}
