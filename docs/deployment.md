# 部署流程

当前开发版实现了视频制作预览；实际部署和真实生成服务联调尚未执行。

## 准备

1. 在目标机器安装 Node.js 22+、FFmpeg、FFprobe 和中文字体。FFmpeg 需支持 libx264 与 libass/subtitles。
2. 克隆仓库，切换到已验证的 commit 或 tag，然后运行 `npm ci`。
3. 参考 `examples/config.example.json` 配置运行目录、素材目录、字体、生图和配音模型。
4. 将密钥写入 DSH 运行环境对应的环境变量，通过 `BILI_PUBLISHER_CONFIG` 指定配置文件。
5. 先运行 `node tools/publisher.mjs status` 检查依赖和密钥是否配置；此命令不会验证服务账号额度或实际生成权限。

运行资料和凭据不放进 Git 仓库。当前默认只允许导入运行目录中的素材，其他目录需要列入 `mediaRoots`。

## 安装到 DSH

此版本使用 `@deepseek-ai/dsh-tools` 原生工具注册，开发与测试使用 `0.2.1-rc.2`；尚需在目标 DSH 实例验证完整加载。

按实际 profile 和路径执行 DSH 的目录安装命令：

```sh
dsh plugin --profile <profile> add "link:/path/to/dsh-bili-publisher"
```

DSH 启动环境需包含配置路径和服务密钥。也可在该插件配置中设置 `configFile`。重启 DSH 后检查五个 `bili_*` 制作工具是否出现。

Web 预览需要 DSH 的 `webServer` 和 `connection` 服务。反向代理需将 `/bili-publisher/jobs/` 路由转发到同一 DSH 实例，并保持登录 Cookie、Host 和同源访问。`publicBaseUrl` 应对应这套路径对外暴露的基础 URL，包含前缀部署时必须同步设置代理重写。

先用草稿与预览验证完整流程，再安排真实发布模块的联调。本版本尚无 B 站发布工具。

## 更新与回退

部署前记录运行中的 commit 或 tag。更新源码后安装对应依赖并重启 DSH；回退时切回上一已验证版本。生成素材、任务和成片留在配置的运行目录中。
