# MIOVA 妙物 · Flutter App

Flutter 客户端与 Web 商城分开，服务端共享。支持平台工程入口：Android、iOS、Windows、macOS、Linux、Web；工程入口不等于各平台已完成原生构建/上架。

## 已实现

- 英语、中文、西班牙语以及系统浅/深色主题。
- 商品搜索、分类、详情、收藏、购物袋与数量限制。
- 收货地址、配送方式、保存待付款订单。
- 订单号 + 邮箱查询状态。
- 购物袋和偏好是设备本地草稿；订单只由服务端保存。
- 下单重试使用 UUID 幂等键，保留已提交内容的 SHA-256 摘要，不在偏好中保存邮箱、电话或地址。
- 手机 / 平板 / 桌面自适应布局、可访问标签、系统字号支持。

## 启动

推荐 Flutter stable 3.47.6（当前锁文件基于 Dart 3.13.5）。先在仓库根目录启动 `npm run dev:web`。

```sh
cd app
flutter pub get
flutter run -d android --dart-define=MIOVA_API_BASE_URL=http://10.0.2.2:5173
```

`-d` 应替换成 `flutter devices` 中的真实设备 ID。`10.0.2.2` 仅适用于 Android 模拟器；真实设备使用可达的 HTTPS 测试地址。原生端不设置 `MIOVA_API_BASE_URL` 时会显示配置提示，不会请求一个不存在的生产 API。

Android 模拟器调试时，用 `npm run dev:web -- --hostname 127.0.0.1` 启动 API，确保监听 IPv4；默认 `localhost` 在部分 Windows 环境只监听 IPv6，模拟器无法连接。`--hostname` 是当前 Vinext 的参数名，不要使用 Vite 的 `--host`。

生产包必须指定已部署、提供 `/api/v1` 的 HTTPS API，例如：

```sh
flutter build appbundle --dart-define=MIOVA_API_BASE_URL=https://你的API域名
```

不要把尚未发布新版接口的旧原型地址当成可用 API。

## 检查与浏览器预览

```sh
flutter analyze
flutter test
flutter build web --base-href /app-preview/
```

回到仓库根目录执行 `node scripts/stage-app-preview.mjs`，启动 `npm run dev:web`，打开 `http://localhost:5173/app-preview/index.html`。预览与 API 同源，避免跨域问题。此预览不会替换主商城首页，生成文件也不会提交。

Flutter 浏览器端默认使用当前源。若独立托管到另一个域名，需要同源反向代理；现有 API 没有开放通配 CORS。原生端不受浏览器 CORS 限制。正式端要求 HTTPS；仅同源本机浏览器预览允许 HTTP。

## 平台环境

- Android：Android SDK、设备/模拟器、签名；主 manifest 已启用 INTERNET，明文 HTTP 仅 debug 配置允许。
- iOS：Mac + Xcode + 签名，不能在 Windows 上验证 iOS 安装包。
- Windows：Visual Studio C++ 桌面工具链；带插件的 Flutter 工程需要 Windows 开发者模式/符号链接能力。
- macOS：Mac 工具链；沙箱出站网络权限已声明。
- Linux：对应 Linux 桌面工具链。

本机依赖已解析，但 Flutter 的 Windows 插件注册提示系统未开启开发者模式；未替用户修改系统设置。当前分析、widget 测试和 Web 构建可通过 `--no-pub` 使用已解析依赖，不能据此声称 Windows 原生安装包已通过。

## 源码

`lib/data/` HTTP 客户端、不可变模型、本地草稿；`lib/state/` 购物状态；`lib/l10n/` 文案；`lib/ui/` 界面；`test/` 状态、HTTP 和多尺寸 widget 回归。

正式应用图标、原生启动页、支付、账号、推送和商店元数据仍待实现。平台目录保留 Flutter 生成的占位图标，不作为最终发布素材。
