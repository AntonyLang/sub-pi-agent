# 开发与发布

[返回 README](../README.md)

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run test:integration
npm run check:package
npm pack
```

单元测试覆盖会话生命周期和工具契约；集成测试使用真实 Pi SDK、MCP 进程与本机假模型，不调用外部模型。CI 矩阵涵盖 Windows、Linux、macOS 的 Node 22.19 和 24。

npm 包仅包含 CLI、编译后的服务、许可、README 和接入范例；不包含配置、认证、会话或测试结果。维护者通过 npm 登录后手动执行 `npm publish --access public`。`v*` 标签触发 GitHub Release 打包，不自动发布 npm。

详细使用文档位于仓库的 `docs/`，不随当前 npm 包分发；README 使用完整 GitHub 文档链接，供 npm 页面和安装包读者访问。
