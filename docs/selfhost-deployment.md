# 独立服务器部署与运维

此部署入口保留原有 Sites/Cloudflare 构建，不修改 `.openai/hosting.json`。独立服务器使用 Node 24 的生产运行时、SQLite 持久化数据库、现有 Nginx 和两个独立 systemd 服务；不使用 Wrangler 开发服务器承接生产流量。

本次授权仅替换 `150.158.141.45` 的 IP 首页。原目录 `/www/wwwroot/linshiceshiwa` 的代码和数据保留，原 IP 虚拟主机配置先备份到 `/srv/miova/backups`。共享 Nginx、MySQL、宝塔面板以及其他端口上的应用不属于停服范围。

## 目录与服务

| 路径/服务 | 用途 |
| --- | --- |
| `/srv/miova/releases/<commit>` | 不可变的源代码、依赖和生产构建 |
| `/srv/miova/current` | 指向当前发布目录的符号链接 |
| `/srv/miova/data/commerce.sqlite` | Web 与后台共用的持久化商城数据库 |
| `/srv/miova/backups` | root-only 的发布前原站配置/代码备份 |
| `/srv/miova/data/backups` | `miova` 可写的 SQLite 一致性快照 |
| `/srv/miova/acme` | 仅用于 HTTPS 证书 HTTP-01 验证 |
| `/etc/miova/web.env`、`admin.env` | 服务端环境变量，不进入 Git |
| `/etc/miova/admin.htpasswd` | Nginx 后台 Basic 验证文件 |
| `miova-web.service` | 仅监听 `127.0.0.1:3100` |
| `miova-admin.service` | 仅监听 `127.0.0.1:3101` |
| Nginx 后台代理 | 仅监听 `127.0.0.1:8081`，通过 SSH 隧道访问 |
| `miova-backup.timer` | 每日 03:15 起、随机延迟最多 15 分钟执行快照 |
| `miova-certificate.timer` | 每 6 小时检查独立 IP 证书续期，成功后检查并 reload Nginx |

服务使用专用的非登录用户 `miova`。发布目录由部署管理员管理且对应用只读；数据库目录仅允许该服务用户写入。环境文件仅管理员可读，后台验证文件仅管理员与 Nginx 工作进程所需的受限组可读。数据库快照目录 `/srv/miova/data/backups` 必须存在且允许 `miova` 写入，权限 `0700`；原站备份目录 `/srv/miova/backups` 为 root-only，不向应用开放。两者都不要放进任何网站根目录。

## 配置约束

Web 环境至少需要下列字段。部署时将实际值写入 `/etc/miova/web.env`，不要把文件复制回仓库。

```ini
MIOVA_RUNTIME=node
APP_SURFACE=web
PORT=3100
MIOVA_SQLITE_PATH=/srv/miova/data/commerce.sqlite
STORE_OWNER_ID=miova-selfhost
STOREFRONT_URL=https://150.158.141.45
PAYMENTS_ENABLED=false
```

后台使用相同的数据库路径、`STORE_OWNER_ID`、HTTPS 商城地址和关闭支付的配置；另设 `APP_SURFACE=admin`、`PORT=3101`，以及 `MIOVA_ADMIN_USERNAME`、`MIOVA_ADMIN_PASSWORD_SHA256`、`MIOVA_ADMIN_EMAIL`。后台的随机独立密码由服务器本地生成，不复用 SSH 密码；Nginx 验证文件与 Node 保存的 SHA-256 摘要必须对应同一个密码。

Node 后台验证仅接受后台服务上的已验证 Basic 凭据，不接受公网传入的 `oai-authenticated-*` 身份头。公开 Web 从不将这些头或 Basic 凭据作为管理员身份。Nginx 公网代理再次清空身份头和 Authorization，且直接拒绝 `/ops` 与原 Sites 登录回调地址。

支付保持关闭：可以展示商品并创建未支付草稿，但不能声称已付款、支付成功或可据此发货。初次迁移只建表，不自动导入示例订单/商品，也不执行用户管理模块的 MySQL SQL。原 Sites 数据未迁移前，新服务器数据库为空；不要把预览页中的内容误认为真实库存。

## 构建与发布顺序

1. 先核实远端分支和其他开发者的改动，再从确定的提交生成发布目录。不要强推、覆盖未合并的工作或删除旧发布。
2. 核实专用端口、用户、数据目录和现有 IP 虚拟主机。将旧配置按时间戳备份，保留原站代码与数据库。关闭的是旧 IP 页面路由；没有证据表明进程仅属于该旧站时，不停止共享进程。
3. 在新发布目录运行锁定依赖安装、类型检查、商业逻辑测试、`npm run build:selfhost` 和 `npm run test:selfhost-build`。后者启动隔离数据库的真实生产包，校验 Web 拒绝伪造身份、后台接受正确独立凭据。服务器已有 Node 24 时不修改全局 Node 或其他应用依赖。
4. 升级数据库前先执行一致性快照，再执行经审查的 SQLite 迁移。迁移记录包含 SQL 摘要，已应用文件发生变化会拒绝继续；不得通过删表或删除迁移记录绕过检查。
5. 安装此目录中的 systemd 模板，运行 `systemctl daemon-reload`。保存原 `current` 链接目标，再切到新发布，启动/重启仅 `miova-web`、`miova-admin`。
6. 先检查本地商城目录接口，再替换已备份的 IP Nginx 配置。运行 `nginx -t` 成功后才 reload Nginx；不要重启共享 Nginx。失败时恢复原 IP 配置和原发布链接，再执行配置检查与 reload。
7. 从外部访问 HTTPS、检查证书、购物页面和敏感操作保护；检查旧站保留和其他站点未受影响。通过检查后启用备份 timer。

模板 `150.158.141.45.conf` 指向独立证书 `/etc/miova/letsencrypt/live/miova-ip/fullchain.pem` 和 `privkey.pem`。新证书未签发时，初次部署可在服务器上的配置副本暂用现有宝塔 IP 证书，不改仓库模板；签发后切到独立路径，先执行 `nginx -t` 再 reload。IP 证书为短有效期证书，必须由实际执行者验证自动续期、HTTP-01 文件可达、续期后的 Nginx reload 以及到期告警；仅存在一个有效证书，不代表续期已配置。

本部署的独立 Certbot 位于 `/opt/miova-certbot`，不替换宝塔或其他应用的证书工具。续期使用 `/etc/miova/letsencrypt`、`/var/lib/miova-acme`、`/var/log/miova-acme` 的隔离目录；HTTP-01 验证目录必须一直可达。执行 `miova-certificate.service` 验证检查流程，使用 Certbot `renew --dry-run` 验证挑战与续期，不将 staging 证书用于用户访问。

定时器已提供随机延迟，所以服务使用 `--no-random-sleep-on-renew`，避免 Certbot 内部随机等待超出服务超时；手动模拟续期也可加此参数。部署配置可单独更新 `/etc/systemd/system` 后 `daemon-reload`，不改已发布应用目录；记录应用提交与配置提交，不将配置更新误当成数据库或应用重建。

Nginx 访问日志格式仅记录路径，不记录查询字符串、Authorization 或请求正文；错误日志仍需受限保存，不要将其未经脱敏共享。库存、订单安全仍由应用逻辑保障，边缘限流不替代这些检查。Nginx body 限制为公开商城 `64k`、后台 `1m`，修改需同时核对应用请求限制。公网没有设置不可撤回的长时 HSTS，以便初次发布或证书配置失败时安全回退。

## 后台访问

在自己的终端建立 SSH 隧道，首次连接时核对服务器密钥。不要关闭主机密钥校验，不要将后台端口开放到公网。

```sh
ssh -N -L 8081:127.0.0.1:8081 ubuntu@150.158.141.45
```

保持此终端连接，在浏览器打开 `http://localhost:8081/ops`，使用独立生成的后台账号密码。浏览器到本机为 HTTP，跨互联网部分在 SSH 加密隧道内。Basic 凭据可能被浏览器缓存，关闭该浏览器会话并关闭隧道才能结束此访问方式，不能把“退出链接”当作可靠的凭据撤销机制。

后台明文密码如果保留，仅放在服务器上另行指定的 root-only 凭据文件中；管理员可在自己的 SSH 终端读取。不要通过聊天、Git、截图或日志分发。换成自有域名且完成独立 TLS 后，仍需显式设计公开后台认证，再决定是否开放。

本次部署凭据保存在 `/etc/miova/admin-credentials.txt`；使用自己的 SSH 终端执行 `sudo cat /etc/miova/admin-credentials.txt` 查看。`/etc/miova` 目录为 `root:www`、`0750` 供 Nginx 遍历，`admin.htpasswd` 为 `root:www`、`0640`；环境文件与明文凭据仍为 `root:root`、`0600`。

## 检查与故障定位

```sh
sudo systemctl status miova-web miova-admin --no-pager
sudo journalctl -u miova-web -u miova-admin --since '15 minutes ago' --no-pager
curl --fail http://127.0.0.1:3100/api/v1/catalog
curl --fail https://150.158.141.45/api/v1/catalog
curl -I http://127.0.0.1:8081/ops
sudo nginx -t
sudo systemctl list-timers miova-backup.timer --all
sudo systemctl list-timers miova-certificate.timer --all
```

目录接口应返回成功的 JSON；空商品列表是首次空数据库的正确结果，支付应为关闭状态。未提供后台凭据时，后台代理应返回 `401`；公网 `/ops` 应返回 `404`；伪造 Sites 身份头不能取得后台数据。使用标准 TLS 验证，不使用 `curl -k` 或忽略浏览器证书警告。

排查问题先看状态和无敏感字段的错误日志，不把完整环境文件或顾客地址输出到共享聊天。服务的内存上限分别为 Web `768M`、后台 `512M`；持续触发 OOM 时先检查实际内存与请求，再调整预算，勿盲目扩大到耗尽同机资源。

## 备份和恢复

手动触发与验证定时备份：

```sh
sudo systemctl start miova-backup.service
sudo journalctl -u miova-backup.service --since '5 minutes ago' --no-pager
sudo systemctl enable --now miova-backup.timer
```

备份使用 `VACUUM INTO` 生成在线一致性快照，不直接复制仍在写入的 `.sqlite` 文件或分开复制 WAL。脚本使用唯一文件名、严格文件路径、`quick_check` 和磁盘同步；校验失败的文件保留为 `.failed` 供检查，不覆盖原数据库。快照包含顾客资料，须按生产数据保护。

需要恢复时，先确认具体快照、实际数据库路径和恢复窗口，停止仅 `miova-web` 与 `miova-admin`。保留当前 `.sqlite`、`-wal`、`-shm` 的完整集合；验证待恢复快照，在数据库目录内准备拥有正确权限的新文件，再以受控切换替代当前数据库。不要在运行中的服务上覆盖数据库，不要将数据库回滚与代码回滚混为一谈，订单写入后的旧快照恢复会丢失新增业务数据，必须由管理员明确批准。

本地每日快照不是完整灾备：尚需配置加密异地备份、恢复演练、保留周期、磁盘空间告警、证书到期告警和故障通知。脚本不自动删除历史快照；确认异地备份可恢复后，再由管理员制定明确的清理策略。
