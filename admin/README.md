# 管理后台

后台源码独立放置，保留现有订单、库存、履约路径和集成状态界面。

在仓库根目录执行：

```sh
npm ci
npm run dev:admin
npm run build:admin
```

开发地址：`http://localhost:5174/`。Web 的 `/ops` 仍然通过薄路由复用这里的页面，以保留原来的入口。这里有独立构建入口，不需要复制商城页面。

两端共用根目录的 Node 依赖和 UI 组件（`web/components/ui`），在根目录安装依赖。后台从 `backend/` 读取服务、从 `shared/` 读取类型。

本地在 `admin/.dev.vars` 设置 `STORE_OWNER_ID=local_seedy` 才能通过本地登录模拟器进行编辑；未登录和非店主账号只能看到演示数据。生产授权仍依赖现有站点的可信身份头，不可把本地模拟器当作生产登录。

单独部署时需要配置 `STOREFRONT_URL=https://你的商城域名`，并接好同一个 D1 和可信身份边界。生产后台未配置商城地址时不会把“返回商城”误链到后台首页。
