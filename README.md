# dsh-bili-publisher

独立的 DSH B 站内容发布插件。当前开发版 `0.1.0-dev.0` 已实现**带配音和字幕的短视频制作预览**；B 站动态发布和视频投稿将在后续接入。

助手负责选题、旁白和分镜，插件负责调用配置好的生图／配音服务，在后台合成成片。也支持使用服务器上的已有图片、视频片段和音频。

## 当前能力

| 能力 | 状态 |
| --- | --- |
| DSH 原生模型工具与独立 CLI | 已实现 |
| 分镜草稿和生成请求数量预览 | 已实现；准备草稿不调用外部服务 |
| 可配置生图接口 | 已实现适配器，模拟接口测试通过，尚未使用真实密钥验证 |
| 可配置配音接口 | 已实现适配器，模拟接口测试通过，尚未使用真实密钥验证 |
| 文字卡片、已有图片／视频片段 | 已实现 |
| 配音、字幕、轻微推拉镜头、固定时长合成 | 已实现，实际渲染测试通过 |
| 后台任务、进度、取消、相同草稿避免重复制作 | 已实现 |
| 视频预览页与下载 | 已实现；安装到 DSH Web 后需登录访问 |
| B 站动态发布／视频投稿 | 待实现 |

当前版本未部署到服务器；没有注册实际 B 站发布工具。

## 依赖与开发

开发依赖中的 Zod 固定到已修复的 `4.6.6`；保留与目标 DSH 一致的 SDK 接口版本。

需要 Node.js 22+、支持 `libx264`、`libass`／`subtitles` 的 FFmpeg、FFprobe，以及可渲染中文的字体。

```sh
npm ci
npm run check
npm test
npm pack --dry-run
```

真实渲染测试在找到 FFmpeg 和 FFprobe 时运行；找不到时会明确标记跳过。可通过 `FFMPEG`、`FFPROBE` 指定路径。CI 会安装这些依赖并运行实际合成测试。

## 配置

参考 [config.example.json](examples/config.example.json)，在运行机器上保存配置，通过 `BILI_PUBLISHER_CONFIG` 或 `--config` 指定位置。默认读取 `$DSH_HOME/bili-publisher.config.json`，没有 `DSH_HOME` 时使用 `~/.dsh/`。

- `dataDir`：草稿、生成素材、任务与成片的运行目录。
- `mediaRoots`：允许导入已有素材的目录。输入应使用服务器绝对路径，符号链接也必须落在允许目录中。
- `image` 和 `speech`：分别指定 `baseUrl`、`model` 和 `apiKeyEnv`，配音还需指定 `voice`。
- 密钥放在对应环境变量中；配置只记录环境变量名称。密钥不会放进分镜、工具结果或任务配置快照。
- `fontFamily`：中文字体名称，例如 Linux 的 `Noto Sans CJK SC`；部署前需安装字体。
- `publicBaseUrl`：对外访问 DSH 的基础 URL；预览路由需要在同一认证入口下转发。

首版支持 OpenAI 风格的 `images/generations`（返回 `data[0].b64_json`）和 `audio/speech`（返回 WAV）接口；不保证所有标为“兼容”的服务都直接可用。可用 `parameters` 设置受支持的额外参数，详见 [制作说明](docs/video-production.md)。

## 用法

[示例分镜](examples/storyboard.json) 描述四幕 40 秒竖屏视频。助手可以通过 DSH 工具提交相同格式。

```sh
node tools/publisher.mjs status --config /path/to/config.json
node tools/publisher.mjs prepare --script examples/storyboard.json --config /path/to/config.json
node tools/publisher.mjs render --draft <draftId> --config /path/to/config.json
node tools/publisher.mjs job --id <jobId> --config /path/to/config.json
```

CLI 加 `--wait` 可以等待制作结束。渲染时才会调用生成服务，可能产生相应服务费用；本插件不自动重试生成请求。

DSH 工具：`bili_publisher_status`、`bili_video_prepare`、`bili_video_render`、`bili_video_job`、`bili_video_cancel`。

制作完成后返回 MP4、封面、SRT 和预览页面路径。在 DSH Web 中可通过任务预览链接播放、下载。制作预览不会提交到 B 站。

## 无密钥本地演示

macOS 可使用程序绘制卡片和系统中文配音验证完整制作流程，无需生图或配音密钥：

```sh
FFMPEG=/path/to/ffmpeg FFPROBE=/path/to/ffprobe node tools/demo.mjs --output /tmp/publisher-demo
```

演示的画面是程序绘制卡片，语音来自 macOS `say`；它不代表已完成真实 AI 生图接口联调。Linux 运行环境应配置配音接口。

## 安装与架构

- [服务器部署](docs/deployment.md)
- [制作流程与已知限制](docs/video-production.md)
- [架构](docs/architecture.md)
- [开发计划](ROADMAP.md)

插件可以独立使用，也可以由 `dsh-bili-whale` 的助手调用。运行资料与账号凭据独立于源码保存。项目许可证暂为 `UNLICENSED`，npm 发布暂时关闭。
