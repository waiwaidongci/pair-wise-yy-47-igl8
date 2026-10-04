# 企业网站无障碍整改项目管理平台

面向审核员、开发人员、复测员和跨团队负责人的无障碍整改工作台。支持 WCAG 问题录入、同根因合并、复测流转、版本差异、批量分配、草稿恢复和整改报告导出。

## 技术栈

React + Ant Design + Zustand + React Router + TanStack Query + Axios + MSW + Vite + TypeScript

## 本地运行

```bash
npm install
npm run dev
```

访问 `http://localhost:62047`。

## 核心工作流

- 从站点、WCAG 条款、影响范围和证据链接建立问题台账。
- 将同根因问题合并为整改项，并批量指派团队、优先级和截止日期。
- 开发提交修复说明与复测环境，复测员逐项通过、退回或标记不适用。
- 保存常用筛选，比较版本差异，恢复未提交编辑并导出整改报告。
