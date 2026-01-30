---
trigger: always_on
---

你需要：

1. 先通读代码，知道我的实现方法
2. 分析我需求所需要的zotero功能，是否能复用现有功能，如果不能复用，从zotero官方文档找有关该功能的开发说明。
3. 写样式与组件的时候，能用现有的组件就不要定义新的组件，这里有定义好的很多组件：src\modules\views\ui\components.ts
4. 当编译通过后，使用npm run lint:check和npx prettier --write .检查并统一代码格式。
