# 短视频制作

## 分镜输入

见 `examples/storyboard.json`。旁白与画面提示由 DSH 助手准备，本插件不额外调用语言模型生成脚本。

- `title`：标题，最多 80 字。
- `orientation`：`portrait`（720×1280）或 `landscape`（1280×720）。
- `durationSeconds`：3–120 秒，按 24 fps 合成，编码后的容器时长可能有少量音频帧误差。
- `visualMode`：`generated` 使用生图服务；`cards` 使用程序绘制卡片。
- `style`：拼在各幕图片提示前面的统一风格说明。
- `scenes`：1–12 幕，每幕有 `heading`、`narration`、`imagePrompt`。
- 可用 `imagePath` 或 `videoPath` 替代该幕生成图片，用 `startSeconds` 选择视频片段起点。
- 可用 `audioPath` 替代该幕生成配音。所有本地素材需要位于配置的 `mediaRoots` 中。

已有素材会在制作时复制进任务目录；原视频音轨不沿用，成片使用旁白音轨。短视频片段会在末尾定格以配合该幕时长。首版尚未加入背景音乐混音、复杂转场或连续角色动画。

## 配音和字幕

旁白按标点切成短句，每句独立生成配音。插件探测实际音频时长后排列字幕，字幕按句对齐，不宣称逐字对齐。

提供 `audioPath` 时没有语音识别／强制对齐步骤，整幕显示对应旁白，返回 `speechAlignment=provided-audio-per-scene`。

配音比目标短时将剩余时间分配为各幕留白；留白过多会返回提示。配音超过目标时明确失败，要求缩短旁白或增加目标时长，避免直接截断说话。

## 服务协议

生图：向 `<image.baseUrl>/images/generations` 发送 `model`、`prompt`、`n=1`、`size`。需要返回 `data[0].b64_json`；当前不下载服务返回的远程图片 URL。`parameters` 支持 `quality`、`output_format`、`background`、`response_format`、`moderation`。

配音：向 `<speech.baseUrl>/audio/speech` 发送 `model`、`voice`、`input`、`response_format=wav`。`parameters` 支持 `speed` 和 `instructions`。

`baseUrl` 需要明确带上服务要求的 API 基础路径，例如 `/v1`。接口采用环境变量中的 Bearer 密钥，不跟随重定向，不向模型输出原始服务错误正文。生成适配器经过模拟接口测试，实际服务仍需配置账号后验证。

协议参考：[图像生成](https://developers.openai.com/api/reference/resources/images/methods/generate)、[语音合成](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)。其他供应商可通过新增适配器支持。

## 后台任务

`prepare` 只校验并保存分镜，返回预计图片和配音请求数。

`render` 校验所需服务与媒体依赖，启动独立 Node 进程并立即返回任务编号。worker 在任务 JSON 中更新阶段与结果；模型无需在编码期间持续运行。预览页面在任务进行中自动刷新，DSH 工具按需查询任务，不自动唤醒模型汇报。

相同草稿运行中或完成后重复调用会返回已有任务。失败或取消后可显式 `retry=true`；这会重新制作，可能再次调用生成服务。意外进程退出会显示 `interrupted`，需重新准备草稿；保留原记录，不自动清锁重发。当前没有断点续传和跨任务生成缓存。

`cancel` 写入取消请求，worker 检查后中止当前请求／编码。已完成的外部请求仍可能计费。任务数据保存在运行目录，当前没有自动删除策略。

## 成片和预览

输出 `preview.mp4`、`poster.jpg`、`subtitles.srt`、`preview.html`。在 DSH Web 注册 `/bili-publisher/jobs/<jobId>/`，通过 DSH `connection.requestRejection` 验证访问，仅提供固定成片文件，支持视频 Range 请求。

独立 CLI 返回本地成片和 HTML 路径。只有安装到 DSH Web 并正确转发预览路径后，任务中的预览 URL 才可从浏览器访问。源码推送不会自动部署。
