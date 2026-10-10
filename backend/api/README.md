# 接口与业务逻辑

- `http/`：商品目录、创建待付款订单、订单查询 JSON 接口和请求校验。
- `services/`：服务端计价、地址与商品校验、履约方式和幂等下单。
- `db/`：D1 数据访问、Drizzle 表结构、订单和后台库存操作。
- `auth.ts`：站点登录和店主授权。
- `payments.ts`：支付适配器接口；当前支付始终关闭。

框架入口仍在 `web/app/api/v1/`，实现统一放在这里。Web、Flutter 和后台共用这些规则，不在客户端复制数据库操作。`@backend/*` 别名指向本目录。

接口契约见仓库根目录 `shared/openapi.yaml`。公共 API 上线仍需完成限流、客户认证、库存统一和监控等验收项。

## 独立账号服务

`user_account/user_account_api.js` 已同步外部开发者提供的 `1.js` 调整：MySQL 用户持久化、bcrypt 密码、Google/Apple Web/App 登录及 Redis 会话。它是独立 Node/Express 服务，不是 Worker 模块，不会自动替换 `auth.ts` 或接入商城登录。

在 `backend/api` 执行 `npm ci`，将 `.env.example` 复制为 `.env` 后填写真实配置，再执行 `npm run start:account`。需要 Node 22.13+、MySQL 和 Redis；默认仅监听 `127.0.0.1:3001`。数据库须由负责账号模块的开发者检查并初始化，启动只测试连接，不自动建表、迁移或修改现有数据。独立测试：`npm run test:account`，使用模拟依赖，不连接外部服务。

同步仅做必要集成修正：移除硬编码 OAuth 密钥及敏感日志、生产环境 Cookie 使用 HTTPS、代理默认不信任、拒绝非法数字滑块坐标，补依赖及启动入口。此前代码出现过的 OAuth 密钥应在服务商侧撤销或轮换，不应继续使用。

尚不满足生产上线条件：邮件/短信发送仍是占位函数；OAuth `state/nonce`、统一账号停用检查、验证码原子消费、并发用户 ID/邮箱/手机号唯一性及账号服务与商城的接入均需后续完成。`../sql/数据库SQL.sql` 仍保留原作者版本（含未注释自然语言及缺失主键/唯一约束），不能未经审核直接执行，更不能作为 D1 商务迁移混跑。
