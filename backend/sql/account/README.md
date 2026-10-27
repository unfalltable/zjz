# 独立账号数据库：MySQL

这里只管理账号服务使用的 MySQL 表，不属于商城 SQLite / D1 的 Drizzle 迁移，不会被商城启动、构建或发布脚本自动执行。压缩包原 SQL 含未注释的自然语言、无 `users` 主键/唯一约束，并且缺少资料接口读写的经纬度等字段；不能直接导入生产库。原作者的 `../数据库SQL.sql` 保留不变。

## 新数据库

使用 MySQL 8.0.21+，优先选用经过运维验证的 MySQL 8.4 LTS。MariaDB 不是本 schema 的验收目标。要求 InnoDB、`utf8mb4` 和 strict SQL mode。先由 DBA 创建独立数据库和最小权限服务账号；不要复用商城 SQLite、其他应用库或 MySQL root。

经确认数据库为空、完成备份与恢复演练后，由 DBA **明确选择目标数据库** 并执行 `0000_account_schema.mysql.sql`。该 SQL 没有 `USE`、`DROP`、种子用户或权限授予；也没有 `IF NOT EXISTS`，已有表会报错而不是掩盖不兼容。不要使用客户端 `--force` 跳过错误。

它创建：

- `users`：数据库分配的 `BIGINT UNSIGNED AUTO_INCREMENT` 主键；邮箱、Google/Apple `sub` 的可空完整唯一键；区号和手机号的联合唯一键；`auth_version` 用于撤销旧会话。
- `user_profiles`：原包资料字段及原接口实际使用的经纬度、`default_cast_method`。保留兼容，不作为购物注册必填项，不用于推荐、风控或资格判断。
- `account_deletion_requests`：只登记申请，不删除账号。生成列唯一键保证同一用户只能有一条待处理申请。
- `account_restrictions`：按用户、生效状态和到期时间查询限制，状态与时间有约束。

引用用户的表使用 `ON DELETE RESTRICT` / `ON UPDATE RESTRICT`，不会因误删账号级联清除资料或审核记录。应用账号需要常规 `SELECT` / `INSERT` / `UPDATE` 权限，不需要建表、删表或任意授权能力。

新注册应省略 `users.id`，使用数据库 `insertId`，并用字符串传输大整数 ID。不得再使用“当前秒级时间戳，冲突加一”的先查后写分配方式。`email` / `backup_email` 在服务端规范为小写、去首尾空白；未绑定的登录身份存 `NULL`，不是空字符串。OAuth `sub` 保留大小写、精确比较；不要把不同第三方供应商的 `sub` 混用。

手机号经过后端 `phoneParts` 统一解析：`users.phone` 存 **nationalNumber**（不含国际区号的规范本地号码），`phone_country_code` 存规范 **`+<countryCallingCode>`**（例如 `+1`、`+44`）。发码、限流等目标使用完整 E.164，但不能将 E.164 全号直接塞进 `phone` 列后再拼一次区号。手机号注册、查找、登录、重置、绑定都按这两个规范字段共同处理，不允许裸手机号 `LIMIT 1` 跨区号匹配。旧库如果存过 `+1...` 全号、无 `+` 区号、国内长途前缀或格式混杂，需在隔离副本按同一解析器核对并人工批准迁移；不能仅去空白或机械加区号。只读 SQL 聚合检查不代替电话号码解析器的逐条语义复核。

## 只读审查

在仓库根目录，使用**只读 MySQL 审查账号**提供以下配置（密钥只放本机环境或被忽略的 `.env` 文件）：

```text
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=<只读审查用户>
MYSQL_PASSWORD=<本机填写，不提交>
MYSQL_DATABASE=<明确选定的独立账号库>
```

也接受原包的 `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME`，优先使用 `MYSQL_*`。

```sh
node --env-file-if-exists=backend/api/.env backend/sql/account/audit-schema.cjs
```

驱动来自 `backend/api` 的依赖；先按该服务的安装说明安装依赖。审查脚本只发出有服务端执行时限的 `SELECT`，导入模块不会加载驱动或连接任何数据库。它检查版本、strict mode、表/列容量、索引/主键、可空身份、精确 OAuth 排序规则、外键、命名且生效的约束，以及重复/未规范化身份、非法 ID、缺失字段、重复注销申请与孤儿引用。输出只包含问题代码和数量，**不输出用户 ID、邮箱、手机号、密码、验证码或数据库凭据**。首次启动空库时会报告缺表，不会替你建表。

退出码 `0` 表示自动检查未发现问题，`1` 表示发现不兼容，`2` 表示无法完成检查。`0` 不等于完整生产认证：仍须 DBA 核对 `SHOW CREATE TABLE` 的完整约束表达式、备份、权限、容量、并发、邮件/短信真实投递与 OAuth 配置。表名/列名或约束名称相同不证明完整语义相同；MySQL 的多个元数据读取也不是跨并发 DDL 的原子快照，审查期间须冻结 DDL。

## 已有账号库：不自动迁移

不要对已有账号库执行初始化 SQL。先冻结账号写入和 DDL、备份并验证可以恢复，再运行只读审查，并由 DBA 检查表结构、数据总量及 MySQL 版本。推荐在新库先完整演练：

1. 把旧库备份恢复到隔离测试环境，记录全部用户 ID 和关系引用。不得重编号用户 ID。
2. 对重复 ID、规范化后相同邮箱、相同区号/手机号或第三方 `sub` 做人工归属核对。不得自动保留第一条、合并、删除或重置密码。
3. 空字符串身份、缺失手机号区号、`NULL` 状态和时间、孤儿资料等先列为人工待办；核对后再做经过审批的数据修复。`status=NULL` 不能擅自改成已启用。
4. 审查所有查询涉及的字段。在 `users` 追加 `backup_email` 和 `auth_version`（后者初始 `0`），在资料表追加经纬度和兼容字段；只能追加缺失列，不能覆盖已有定义或内容。若已有同名列定义不同，停止并单独评估。
5. 保留原有 ID，核对所有引用 ID 均为正整数、类型一致、无重复后，再由 DBA 为 `users.id` 加主键/自增，并给子表对齐 `BIGINT UNSIGNED`。确认下一次自增值大于现有最大 ID；不要手动把计数器调低。
6. 在归属冲突全部解决后，分别增加完整唯一索引、外键、状态/格式约束与待注销生成列。评估每条 `ALTER TABLE` 的锁表、磁盘空间和应用停机窗口。
7. 再运行审查、核对用户总量和 ID/资料关联不变，执行隔离注册/登录/改绑/撤销/注销申请并发验收。撤销旧的 Redis 会话应作为单独有记录的安全切换，不删除无关 Redis 数据。
8. 验证恢复方案后切换账号服务配置；商城、管理员验证和商品订单数据库保持原样。若任何一步失败，停止切换，不继续跳过错误。

这里不附“自动修复所有旧库”的迁移脚本，因为未知旧库的重复身份、数据归属、状态含义和外键不能靠程序安全猜测。MySQL DDL 会隐式提交，`START TRANSACTION` 并不能把多条 `ALTER TABLE` 包成可一键回滚的迁移。上线时要按真实库审查结果制作单独审批的增量迁移。

## 本地验证与边界

```sh
node --test tests/account-schema.test.cjs
```

测试使用内存中的假驱动检查审查查询、拒绝不兼容 schema、隐私输出及文件边界，不连接 MySQL/Redis，不发邮件/短信，也不执行原包 SQL。这些测试不替代目标 MySQL 版本上实际执行建表与集成验收。

参考：[MySQL CHECK 约束](https://dev.mysql.com/doc/refman/8.4/en/create-table-check-constraints.html)、[主键和唯一键](https://dev.mysql.com/doc/refman/8.4/en/constraint-primary-key.html)、[InnoDB 自增](https://dev.mysql.com/doc/refman/8.4/en/innodb-auto-increment-handling.html)、[DDL 隐式提交](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)。
