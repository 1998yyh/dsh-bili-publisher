# 制作工具

- `publisher.mjs`：独立 CLI，提供 status / prepare / render / job / cancel。
- `render-worker.mjs`：后台制作 worker，由服务层启动。
- `demo.mjs`：macOS 离线卡片＋系统配音演示。
- `check.mjs`：源码语法检查。

CLI 与 DSH 工具使用同一服务层。B 站实际发布尚未实现。
