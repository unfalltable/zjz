# 共享契约

`catalog.ts` 为当前示例商品与本地化描述的单一源码，Web 和服务端直接复用。Flutter 从 `/api/v1/catalog` 读取它，不手动复制商品数据。

`ops-types.ts` 为订单状态与三种履约方式的类型；`openapi.yaml` 记录 HTTP 接口。Dart 不能直接导入 TypeScript；Flutter 使用与此契约对应的不可变 JSON 模型，以后可通过 OpenAPI 生成各语言客户端。

价格以整数美分传输。服务端忽略客户端价格，重新校验商品与数量并计算总额。当前币种是 USD，语言切换不等于汇率或结算币种切换。
