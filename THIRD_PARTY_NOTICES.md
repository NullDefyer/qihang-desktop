# 第三方组件和素材

本项目的自有代码使用 MIT。第三方组件、图标、商标与外部服务保留各自的权利和使用条件，项目许可证不替代它们。

| 组件 | 用途 | 上游许可 |
| --- | --- | --- |
| React / React DOM | 界面 | MIT |
| Electron | Windows 桌面运行时 | MIT；随运行时附带 LICENSE 和 LICENSES.chromium.html |
| Vite / React plugin | 前端构建 | MIT |
| Phosphor Icons | 界面图标 | MIT |
| Simple Icons | 中间件品牌图标数据 | CC0-1.0；品牌商标权不因此转让 |
| ssh2 | SSH 连接与转发 | MIT |
| mysql2 | MySQL/MariaDB 只读采集 | MIT |
| node-redis | Redis 只读采集 | MIT |
| electron-builder | Windows NSIS 安装构建 | MIT；安装工具链另有上游许可 |

依赖的准确版本与传递依赖由 [package-lock.json](package-lock.json) 锁定。安装后的 `node_modules/<package>` 保留上游 LICENSE/NOTICE；便携打包会复制所需运行时及依赖的许可文件。重新分发构建产物时应保留这些文件。

`src/assets/glass-wallpaper.png` 和 `src/assets/deep-space.png` 为开发过程中生成的背景图片，随项目源码提供。图中的第三方品牌图标仅用于识别所配置的服务，不表示官方合作或背书。

GitHub、MyMemory 和各中间件名称属于其权利人。使用外部服务时遵守相应服务条款、接口配额和隐私要求。
