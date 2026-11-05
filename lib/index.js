import { defineTool } from '@deepseek-ai/dsh-tools'
import { createService } from './service.js'
import { mountRoutes } from './routes.js'

export const name = 'dsh-bili-publisher'

export default {
  name,
  inject: { required: ['tools'], optional: ['webServer', 'connection'] },
  apply(ctx, config = {}) {
    const service = createService({ configFile: config.configFile })
    const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }
    function register(name, description, parameters, execute) {
      ctx.tools.register(defineTool({ name, description, parameters, output, async execute(args) {
        try { return JSON.stringify(await execute(args)) }
        catch (error) { return JSON.stringify({ ok: false, error: error.message }) }
      } }))
    }
    register('bili_publisher_status', '检查视频制作依赖和生图、配音配置。当前版本能制作预览，B 站发布仍待接入。', {}, () => service.status())
    register('bili_video_prepare', '准备短视频分镜草稿，不调用生成服务。storyboard 为 JSON 字符串：title、durationSeconds(3–120)、orientation(portrait/landscape)、visualMode(generated/cards)、style、scenes；每段包括 heading、narration、imagePrompt，可使用 mediaRoots 内已有 imagePath/videoPath/audioPath。', {
      storyboard: { type: 'string', required: true, description: '分镜 JSON；generated 模式需生图接口，cards 模式绘制文字卡片。通常 4–8 幕；旁白总长度应匹配目标时长。' },
    }, ({ storyboard }) => service.prepare(JSON.parse(storyboard)))
    register('bili_video_render', '按已准备的草稿生成图片与配音，并在后台合成带字幕视频。这会调用已配置的生成服务，可能产生服务费用。返回任务编号；用 bili_video_job 查询。只制作预览，不发布到 B 站。', {
      draftId: { type: 'string', required: true }, retry: { type: 'boolean', description: '先前任务失败或中断后，显式重新制作。可能重新调用生成服务。' },
    }, ({ draftId, retry }) => service.render(draftId, { retry }))
    register('bili_video_job', '查询视频制作进度、错误或成片预览链接。等待和编码由后台程序执行，无需模型持续运行。', { jobId: { type: 'string', required: true } }, ({ jobId }) => service.getJob(jobId))
    register('bili_video_cancel', '请求取消当前制作任务。', { jobId: { type: 'string', required: true } }, ({ jobId }) => service.cancel(jobId))
    mountRoutes(ctx, service)
  },
}
