# 参与贡献

感谢你帮助完善启航。提交 Issue 或 Pull Request 前，请先查看 [README](README.md) 中的功能范围和限制。

## 本地开发

推荐 Windows 10/11、Node.js 22 LTS、npm 10 或更新版本、Git，以及系统自带的 Windows PowerShell 5.1。请使用仓库中的 package-lock.json：

```powershell
npm ci
npm run desktop
```

只预览前端可运行 `npm run dev`。浏览器不会启动本机进程、连接 SSH 或清理文件；远程页面为明确标识的演示模式。

## 提交前检查

```powershell
npm test -- --test-concurrency=1
npm run build
npm run test:sites
npm run check:public
```

最后一项检查 Git 索引中将公开的文件，未暂存的新文件需先 `git add`。测试使用隔离临时目录和本机协议夹具，不能连接真实服务器或清理个人缓存。Windows 进程、ACL 和卸载测试需要在 Windows 执行；不要为了让非 Windows 环境通过而删除这些断言。

## 修改约定

- 单个 PR 聚焦一个问题，说明触发条件、修改后的行为和实际验证。
- 保留服务日志自动跟随/横向滚动、可拖动分栏、首页五模块自适应和独立纯文本笔记。
- Electron 主进程负责进程、文件、SSH 和数据库操作；渲染器通过受限 preload IPC 调用。
- 不引入远程任意命令执行、任意路径清理或数据库写操作。命令收藏仍须用户预览确认。
- 密码可选保存时使用 Electron safeStorage，不把密码/密文/私钥内容发送到渲染器、日志或备份。
- 不提交依赖、安装文件、个人数据、备份、日志、令牌或本机配置。安装程序放到 Release，不能提交到 Git 历史。
- PowerShell 和 NSIS 文件保留 UTF-8 BOM，避免中文提示乱码。

提交贡献即表示你有权提交这些内容，并同意它们按本仓库的 [MIT License](LICENSE) 发布。第三方素材仍遵守其原许可证和商标规则。
