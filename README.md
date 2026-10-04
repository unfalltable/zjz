# MIOVA 妙物

面向海外消费者的跨境购物项目。按已确认的方案：Web 商城保留 React / Vinext，App 使用 Flutter，后台独立目录，共用服务端商品与订单逻辑。支付暂缓，不收款、不假装支付成功。

## 目录

```text
hatchway/
├── web/       Web 商城、Web 路由、UI 组件、静态商品资源
├── app/       Flutter 客户端（Android / iOS / 桌面 / Web 预览入口）
├── admin/     管理后台，独立开发和构建入口
├── backend/   服务端业务、HTTP API、数据库、认证、支付接口、迁移
├── shared/    共享商品模型、履约类型、接口契约
├── scripts/   仓库级运行、构建与检查脚本
└── .openai/   现有站点托管配置
```

`web/app/` 是 Next 风格路由目录；根目录 `app/` 才是 Flutter 工程。Node 依赖统一在仓库根目录安装，Flutter 单独管理 Dart 依赖，两个锁文件都应提交。

## 分支与现有功能

改造前只有 `main`，没有独立 Web/App/后台功能分支。GitHub 的 `origin/main` 是同一条主线，`sites` 是旧网站源码远端，不是另一套产品。历史上的七个提交包含原型迭代，不应当成七个功能分支。

| 模块 | 当前已实现 | 尚未完成 |
| --- | --- | --- |
| Web 商城 | 英/中/西语言、搜索、分类、排序、商品详情、收藏、购物袋、配送国家 | 商品目前仅 3 个示例 SKU，完整商用商品中心与 SEO 内容仍待完善 |
| 下单 | 地址校验、配送选择、服务端计价、D1 持久化、幂等保存待付款订单 | 实际收款、退款、税费规则、可靠库存预占 |
| 订单查询 | 订单号 + 下单邮箱查询真实数据库记录 | 实际承运商轨迹同步、客户账户与更强订单访问验证 |
| 后台 | 店主登录校验、订单列表、状态变更、库存增加、三种履约路线展示 | 采购/供应商/货代自动派单、完整 RBAC、审计、售后 |
| Flutter App | 英/中/西语言、商品目录、详情、收藏、购物袋、待付款下单、订单查询；本地偏好与购物袋草稿 | 原生工具链验证、商店签名/上架、推送、正式客户登录 |
| 平台连接 | 已留业务层与版本化 HTTP 接口 | PDD、物流、供应商、支付等真实外部接入尚未完成 |

三种履约方式已在订单模型中区分：国内平台卖家发货、自有打包发货、供应商发货。这不等于已经调用真实供应商或物流服务。

## Web / 后台启动

要求 Node.js >= 22.13。所有 Node 命令在本目录执行：

```sh
npm ci
npm run dev:web       # http://localhost:5173
npm run dev:admin     # http://localhost:5174（另一个终端）
npm run typecheck
npm run build:web
npm run build:admin
```

`npm run dev` 与 `npm run build` 仍默认指向 Web，`npm run start` 使用根目录的 Worker 构建输出。`/ops` 保留旧入口，实际后台源码位于 `admin/`。

本地分别在 `web/.dev.vars`、`admin/.dev.vars` 配置 `.env.example` 的变量。若要测试本地模拟登录，店主 ID 使用 `local_seedy`；生产继续使用该站点的真实店主身份 ID。所有 `.dev.vars` 均忽略提交。

两个本地开发服务共享仓库根目录 `.wrangler/state` 的 D1 开发数据。`npm run test:api` 只允许访问本机，会创建一条测试待付款订单，不会支付、发货或访问生产库。

## Flutter

已使用 Flutter stable 3.47.6 / Dart 3.13.5 创建多平台工程。运行、测试、平台准备见 `app/README.md`。Flutter 与 Web 使用同一个 `/api/v1`，不直接访问数据库，不内置商家秘密。

架构为：界面 → `StoreModel` → `CommerceApi` → 服务端业务 / D1。状态、数据请求与界面分开，遵循 [Flutter 官方架构建议](https://docs.flutter.dev/app-architecture/recommendations)。

## 支付和正式上线边界

支付始终关闭。保存订单是 `pending` / `payment_pending`，不会扣款，不会允许后台推进未付款订单发货。资质齐备后需单独实现支付供应商、验签回调和对账，不能靠改一个开关上线。

本次是多端结构改造与客户端基础，不代表已达到商用验收。正式上线仍需统一数据库商品/库存（目前后台库存与静态商城目录有差异）、完善客户认证、反滥用与限流、数据保护、真实履约连接、售后、监控与原生端发布验证。

数据库迁移移动到 `backend/drizzle/`，已有 SQL 和元数据内容不变。新增表结构时追加迁移，不改已应用的历史文件。

现有站点托管配置保留。本轮当前 Sites 账号无法找到该站点，因而没有进行线上发布；本地构建成功不等于线上地址已更新。
