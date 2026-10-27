# 新版账号模块整合

## 本轮替代关系

以用户提供的 `完整版账号登录模块.zip`（2026-10-24 版本）作为功能来源，不再运行旧的单文件账号系统。源文件 SHA-256：`f20333930b6634f4ba60cae0f9227eb50805108687c112a216232ce7859bd2f7`。

- `backend/api/account/api_server.cjs` 是唯一账号服务入口，模块按 `common/`、`captcha/`、`sender/`、`user_account/` 拆分。
- 原 `backend/api/user_account/server.cjs` 和 `user_account_api.js` 仅转接同一个新版入口；不是第二套实现。旧实现可从 Git 历史恢复，不导入压缩包的 `.bak`。
- 保留原 `/api/account/*` 核心路径及协作者补充的 `/me` 资料字段。接口请求参数、二次验证规则见 [账号 API](../backend/api/account/README.md)。安全集成不是逐字复制：已去除硬编码密钥、开发默认密码、敏感日志和假发送。
- 支付保持关闭，管理员 Basic 认证与商城 SQLite 数据库均不替换。

## Web 商城接入

商城首页有“我的账户”入口，页面为 `/account`，提供英／中／西文登录、验证码登录、注册、找回密码、昵称、头像、改密和退出界面。不自动把旧匿名订单按邮箱归属给账号；订单查询仍使用原订单号＋下单邮箱流程。

浏览器调用本站 `/api/account/[...path]`，由受限网关转发到配置的 `ACCOUNT_API_URL`。该目标只接受固定 loopback HTTP origin，例如 `http://127.0.0.1:3002`；不能由请求参数指定其他服务器。未配置、非 Node 环境或账号服务不可达时明确不可用，不回退演示登录。

Web 登录令牌只存在 `miova_customer_session` HttpOnly Cookie 中，生产使用 Secure、host-only、SameSite=Lax；不保存到 localStorage、购物袋或 URL，不把上游令牌 JSON 暴露给浏览器。网关不转发管理员 Basic、Sites 身份头、浏览器 Bearer、客户端 token/user_id。普通写请求必须同源。OAuth 仅允许固定官方授权地址与本站 `/account` 回跳，临时 state Cookie 限于 `/api/account`；状态与 nonce 由账号服务一次性校验。

原生 App 的账号 JSON/Bearer 契约由同一新版 Node 服务提供；此浏览器网关刻意不返回 App token。Flutter 登录 UI、原生 SDK、Keychain/Keystore 和原生 API 安全网关仍需单独接入，不能把 Web Cookie 代理当作已经完成 App 登录。

## 运行配置与已有账号数据

本轮选择沿用已有账号数据，不自动创建、重建、删除或清空真实库。账号服务启动只做结构审查，不执行 DDL。需要将旧库复制到隔离环境审查差异，保留全部用户 ID、关系和密码哈希，人工解决重复身份后再批准增量迁移；不要直接对旧库执行初始化 SQL。

数据库规范、只读审查和新库模板见 [账号数据库说明](../backend/sql/account/README.md)。账号库是独立 MySQL，不可把其 SQL 混进商城的 SQLite / D1 journal。`auth_version` 与新版 Redis 命名空间用于撤销旧会话；切换时旧登录态不沿用，用户需要重新登录，旧密码哈希不因此重写。

1. 在 `backend/api/` 安装锁定依赖：`npm ci`。
2. 按 `backend/api/.env.example` 在本地／服务器被忽略的 `.env` 配置已有账号库、Redis、`ACCOUNT_PUBLIC_ORIGIN` 和持久头像目录。不要提交实际密钥。
3. 对已备份的隔离副本运行 `node --env-file-if-exists=backend/api/.env backend/sql/account/audit-schema.cjs`；评估差异后才切换真实配置。
4. 在 `backend/api/` 执行 `npm run start:account`；默认仅监听 `127.0.0.1:3002`。`3001` 不作为新默认端口，以免冲突其他应用。
5. 在 Node Web 的服务端环境配置 `ACCOUNT_API_URL=http://127.0.0.1:3002`，再重启该 Web 服务。后台管理员凭据保持原配置。

自托管模板为 `deploy/selfhost/miova-account.service`：由 `miova` 用户运行唯一入口，从 root 管理的 `/etc/miova/account.env` 读取配置，仅允许写入持久头像目录 `/srv/miova/data/account-avatars`。安装服务前创建该目录并授予 `miova` 所有权和 `0700` 权限；环境文件使用 `0600`，明确设置生产 HTTPS `ACCOUNT_PUBLIC_ORIGIN`。MySQL、Redis 与可选发送服务仍使用实际配置，模板不会安装、重建或接管它们。

服务器账号 API 使用 `/etc/miova/account.env` 覆盖为 `ACCOUNT_PORT=3202`，Web 对应设置 `ACCOUNT_API_URL=http://127.0.0.1:3202`；保留现有其他应用占用的 `3002` 端口。`NODE_ENV` 必须显式为 `production`，不能照搬开发示例中的值。

独立 Redis 模板为 `deploy/selfhost/miova-account-redis.service`，账号服务通过 `Requires`／`After` 依赖它。可通过 apt 安装 Redis 可执行程序，但只启用此独立服务，不接管系统默认 Redis 或其他应用实例。由服务器本地 `/etc/miova/account-redis.conf` 设置 `bind 127.0.0.1`、端口 `6382`、受保护模式、独立 ACL／强密码、`dir /srv/miova/data/account-redis`、持久化和适合 `MemoryMax=192M` 的较低内存上限；密钥和实际配置不提交仓库。该目录使用 `miova:miova`、`0700`，配置需让进程可读（例如 `root:miova`、`0640`），且不允许进程写入。账号 `REDIS_URL` 指向此实例并包含对应凭据，不能复用其他应用的 Redis 数据。

IP Nginx 模板只对精确路径 `/api/account/avatar` 放宽到 5 MiB 图片加 64 KiB multipart 封装，仍经过 Web 的鉴权与同源校验；其余路径维持原 64 KiB 上限。发布时先 `nginx -t` 再重载。原商城 `upgrade.sh` 只协调 Web／后台与 SQLite，账号服务启停、旧账号库备份及失败回退需要在此次切换中单独协调，不能将商城快照当作账号 MySQL 备份。

邮件、短信、Google/Apple 各自按真实配置启用。缺配置时 `/api/account/config` 返回 false，发码／第三方登录返回不可用，不能标为“已发送／已连接”。头像目录必须是持久绝对目录，不放 release 或公共目录；服务会解码重编码为随机名 WebP，先鉴权再写入。命理出生资料接口只保留后端兼容且默认关闭，购物注册不采集这些资料。

## 反向代理与限流

默认不信任客户端转发的 IP。生产要按真实客户端 IP 限流时，必须同时满足：

- Web、账号 Node 服务均只监听 loopback。
- 公开 Nginx **覆盖** `X-Real-IP $remote_addr`，不把客户端原始 XFF 当成真实来源；仓库现有商城 Nginx 模板已有该覆盖。
- Web 配置 `ACCOUNT_TRUST_NGINX_IP=true`，账号服务配置 `ACCOUNT_TRUST_PROXY=loopback`。

网关只向账号服务发送校验后的单个 IP，不转发浏览器 XFF 链。不要在直接面向公网的 Node 上打开这些选项。未配置可信链时请求共享 loopback 限流，不能当成已完成多用户吞吐验收。

## 验证范围

在根目录执行：

```sh
npm run typecheck
npm run test:account
npm run test:commerce
npm run build:selfhost
npm run test:selfhost-build
```

新版后端测试使用注入式 MySQL／Redis 和本机 HTTP；网关单测不联网，生产 smoke 使用新建临时 SQLite 和明确的内存上游 fixture，不代表真实 MySQL、SMTP、短信或 OAuth 服务商已经联调。测试不会创建真实账号、发送邮件短信或求解生产验证码。

本轮不自动连接或修改未知生产账号库；未完成真实配置和旧库兼容审查前，不应宣称账号服务已上线。原包中的密钥字符串应由持有人在服务商侧撤销／轮换，不能复制回新配置。
