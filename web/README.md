# Web 商城

保留 React / Next 风格路由与 Vinext Worker 部署，避免把消费者商城改成只有 App 式渲染的页面。目录中的 `app/` 是 Web 框架路由约定，不是仓库根目录的 Flutter `app/`。

根目录执行 `npm ci`、`npm run dev:web`、`npm run build:web`。开发地址 `http://localhost:5173/`。

页面：`/` 商城、`/checkout` 下单、`/track` 查询、`/ops` 原后台兼容入口。

`/api/v1/catalog`、`/api/v1/orders`、`/api/v1/orders/track` 是共享接口，逻辑由 `backend/http/` 承担。

构建输出在 `web/dist/`，根目录的构建脚本将它复制为托管所需的 `dist/`，包含 Worker、静态资源、站点配置和原数据库迁移。根目录 `.openai/hosting.json` 中的站点 ID 保持不变。

本地环境变量放在 `web/.dev.vars`；不要提交该文件。
