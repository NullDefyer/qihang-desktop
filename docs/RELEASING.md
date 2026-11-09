# 构建与发布

## 本地构建

使用 Windows、Node.js 22 LTS 和仓库锁文件：

```powershell
npm ci
npm run check:public
npm test -- --test-concurrency=1
npm run build
npm run test:sites
npm run build:installer
```

`release/Qihang-Setup-<版本>.exe` 为中文 NSIS 安装包，支持自定义目录、安装范围和卸载数据选择。默认未签名。构建需联网下载 Electron/NSIS 辅助组件。

`npm run build:portable` 生成完整便携文件夹。如果只刷新已有便携版资源并保留相邻数据：

```powershell
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-portable.ps1 -UpdateAppOnly
```

安装打包始终使用新的 `.installer-stage-<UUID>` 目录，不能改成从个人便携目录直接打包，否则可能泄漏用户记录。生成的 `build/installer-files.nsh`、`dist/`、`release/` 均不提交。

## GitHub Actions

- **CI**：main 分支 push / Pull Request / 手动运行时，在 Windows 执行公开源码检查、功能测试、前端构建和静态预览检查。工作流只有 contents:read。
- **Build Windows installer**：在 Actions 页面手动运行，验证后生成安装包，作为保留 14 天的 workflow artifact 下载；不会自动创建公开 Release。

无需为这些流程添加个人访问令牌。不要在日志或 workflow 配置中写入 SSH 密码、服务器信息或个人代理认证。

## 发布版本

1. 更新 package.json / package-lock.json 中的根包版本，以及界面显示的版本说明；说明本次用户可见变化。不要全局替换锁文件中的版本字符串，否则会破坏同名版本号的传递依赖。
2. 执行验证，用干净源码构建安装包，并检查安装载荷不包含业务数据、目录指针、密码或备份。
3. 提交到 main，创建对应的 `v<版本>` 标签并推送。
4. 在 GitHub Releases 创建对应版本，附上安装包与变更说明。不要上传自己使用的便携目录、数据或日志。
5. 可提供 SHA256 便于核对：

```powershell
Get-FileHash -LiteralPath release/Qihang-Setup-0.1.5.exe -Algorithm SHA256
```

GitHub 会自动生成标签对应的源代码下载；本地也可使用 `npm run export:source`。该命令只导出最新提交，未提交文件不在压缩包内。

## 首次公开前

检查仓库文件清单、README 截图与提交作者邮箱；建议使用 GitHub 提供的匿名提交邮箱。运行 `npm run check:public`，人工核对示例与测试夹具，确认只有生成的测试密钥而无真实私钥。自动扫描不能保证识别所有敏感内容。

安装包与业务数据分开发布。开源代码的 MIT 许可不覆盖第三方商标和外部服务，见 THIRD_PARTY_NOTICES.md。可在仓库设置中启用 Private vulnerability reporting，接收私密漏洞报告。
