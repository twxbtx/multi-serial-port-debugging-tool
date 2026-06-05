# Development Notes

这份文件记录 `serial-assistant` 迭代过程中已经踩过、确认过、以后应避免重复的问题。

## 1. Electron 打包黑窗

- 不能简单依赖 `loadFile(dist/index.html)` 就认为打包版一定可用。
- 更稳的方案是：
  - 打包后在主进程里启动一个本地静态服务
  - 再通过 `loadURL(http://127.0.0.1:PORT/)` 加载前端
- 自检日志已证明这个方案能正确加载：
  - `index.html`
  - `assets/*.js`
  - `assets/*.css`

结论：
- 打包版优先走“内置本地静态服务 + loadURL”。

## 2. Vite 资源路径

- Vite 默认根路径在桌面打包场景下容易出问题。
- 必须显式设置：

```ts
base: "./"
```

结论：
- 只要这个应用还要支持本地静态资源加载，就不要去掉这个配置。

## 3. 旧 HTML 入口不能直接双击

- 根目录 `index.html` 是 Vite 开发入口，不是最终发布入口。
- 直接双击会白屏或空白。
- 当前已改成：
  - 若 `file://` 打开根 `index.html`
  - 自动跳转到 `dist/index.html`

结论：
- 不要把开发入口误当成最终静态发布页。

## 4. `rcedit` / 图标 / 中文路径

- 打包时 `rcedit` 很容易在中文路径或资源写入阶段报：
  - `Fatal error: Unable to commit changes`
- 处理方式：
  - 图标先转成真 `ico`
  - 复制到纯英文路径再供打包用
  - 打包命令增加：

```text
--config.win.signAndEditExecutable=false
```

结论：
- 这个项目后续如果再加图标或版本资源，优先走英文临时路径，不直接吃中文路径资源。

## 5. `win-unpacked` 被占用

- 重复打包时，如果旧的 `SerialAssistant.exe` 或原生模块文件还被占用，会导致：
  - `Access is denied`
  - 删除 `win-unpacked` 失败
- 现在一键脚本里已经做了：
  - 先杀旧进程
  - 删除失败则改名挪开旧目录

结论：
- 打包脚本必须先处理旧进程和旧输出目录，不能假设目录总是可删。

## 6. 不能只验证“进程活着”

- 以前只看 EXE 是否启动，会误判“活着但黑窗”为成功。
- 现在自检标准是：
  - 进程启动
  - 页面资源加载
  - `root` 节点有内容
  - 页面文本里有主界面特征，或 `rootChildren > 0`

结论：
- 桌面版验证必须至少做到 DOM 级，不只看进程。

## 7. 浏览器预览页不要强行做真实串口

- Web 预览页走 `Web Serial` 会带来：
  - 授权复杂
  - 用户体验差
  - 日志里反复出现取消授权异常
- 当前策略：
  - 浏览器预览页主要看 UI
  - 真实串口只在桌面版 EXE 使用

结论：
- 不再为 Web 预览页继续扩展真实串口能力。

## 8. 默认串口不能伪装成 `COM1`

- 没有真实串口时显示 `COM1` 会误导用户，以为刷新失败。
- 当前已改成：
  - 默认 `path = ""`
  - 文案显示 `未选择串口`

结论：
- 默认值必须是“空状态”，不能是假设备名。

## 9. 默认波特率

- 需求明确要求：
  - 默认 `2M`
  - 最大支持到 `3M`
- 当前已补到：
  - `1000000`
  - `1500000`
  - `2000000`
  - `3000000`

结论：
- 后续不要再把默认值改回 `115200`。

## 10. 多命令发送区设计

- 多条命令编辑如果做成多行大卡片，会挤占主观察区。
- 更合适的是：
  - 一行完成勾选、格式、延时、顺序
  - 第二行只放 payload 和发送/删除
- 用户更在意：
  - HEX/字符串切换
  - 延时
  - 顺序
  - 是否参与批量发送

结论：
- 命令区持续朝“单行高密度编辑”收，不再做大块说明型区域。

## 11. 核心布局原则

- 左：会话列表
- 中：串口收发观察主区
- 右：轻量配置与辅助操作

不应该反过来：
- 让右侧复杂配置长期霸占高度
- 让虚拟联调占据核心区域
- 让文件发送占一整块大区域

结论：
- 中间日志观察永远优先级最高。

## 12. 日志区行为

- 日志刷得快时，不能把 pane 高度越撑越大。
- 正确方式：
  - 固定 pane 高度
  - 内部滚动
  - 支持自动跟随最新
  - 支持锁定滚动位置

结论：
- 所有日志面板都要“定高 + 内滚动”。

## 13. 清理策略

用户要求最终目录尽量干净，只保留：

- 源码
- 一键打包脚本
- 最终免安装 EXE

中间产物应尽量清理：

- `dist`
- `release`
- `win-unpacked`
- 旧伪图标
- 临时调试脚本

结论：
- 一键打包脚本负责产出并收尾清理，不把中间目录长期留在项目根目录。

## 14. 实操建议

以后继续改这个项目时，推荐顺序：

1. 改前端结构
2. `npm run lint`
3. `npm run build`
4. 跑 `build-portable.bat`
5. 看 EXE 自检日志
6. 真机串口验证

如果 EXE 再黑：

1. 先看自检日志是否有：
   - `did-finish-load`
   - `selftest`
   - `selftest-timeout-summary`
2. 再看是否是资源没加载，还是前端运行时异常

## 15. Windows 原生标题栏 / 图标 / 窗口按钮

- Windows 桌面版需要原生标题栏时，不要把主窗口做成透明窗口。
- 这次问题表现为：
  - 右上角没有最小化、最大化、关闭按钮
  - 左上角没有应用图标和软件名称
- 原因组合：
  - `BrowserWindow` 设置了 `transparent: true`
  - 背景色是全透明 `#00000000`
  - `BrowserWindow` 没有显式传 `icon`
  - 开发环境图标路径误指向 `build/icon.ico`，但实际图标在项目根目录 `icon.ico`
- 修复原则：
  - `frame: true`
  - `transparent: false`
  - 给窗口设置不透明 `backgroundColor`
  - `icon: getAppIconPath()`
  - 开发环境图标路径指向根目录 `icon.ico`

结论：
- 这个项目默认走 Windows 原生标题栏，不再用透明无边框窗口模拟外壳。

## 16. DevTools 不要默认弹出

- 开发版自动 `openDevTools({ mode: "detach" })` 会让用户误以为打开的是软件异常窗口。
- 这次截图里看到的蓝色标题栏其实是 Chrome Developer Tools，不是主窗口。
- 当前策略：
  - 默认不打开 DevTools
  - 只有设置 `SERIAL_ASSISTANT_OPEN_DEVTOOLS=1` 才打开

结论：
- 调试工具必须显式打开，不能作为普通启动默认行为。

## 17. 主题变量不能串味

- `深色主体` 和 `TI 红` 不能共用红色强调色。
- 这次问题表现为：
  - 选择 `深色主体` 后仍出现红色按钮、红色边框、红色强调线
  - 视觉上和 `TI 红` 几乎一样
- 原因：
  - 根主题和 `deep-dark` 都使用了红色 `--theme-accent`
  - `industrial-dark` 只有菜单项，没有独立 CSS 变量，实际靠根主题红色生效
- 当前策略：
  - 根主题和 `deep-dark` 使用低饱和冷灰强调色
  - `industrial-dark` 单独定义 TI 红变量

结论：
- 新增主题菜单项时必须同时补齐 `:root[data-theme="..."]` 变量，不能靠根变量碰巧生效。

## 18. 打包自检超时残留

- `build-portable.ps1` 如果在最终 portable 自检阶段超时，可能残留：
  - `build-portable.ps1` 的 PowerShell 进程
  - `SerialAssistant-portable.exe`
  - Vite 开发服务
- 后续继续构建前，应先确认没有旧进程占用输出目录。

结论：
- 打包命令超时后先清理残留进程，再继续改代码或重新打包。

## 19. 打包脚本入口和控制台编码

- 直接在 PowerShell 里执行 `.\build-portable.ps1` 可能被执行策略拦住：
  - `running scripts is disabled on this system`
- 可用方式：
  - 优先跑 `build-portable.bat`
  - 或临时使用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1`
- `.bat` 输出自检日志时，中文标题可能在控制台显示成乱码。
- 这通常是控制台编码显示问题，不代表应用标题或日志文件坏了。
- 确认方式：
  - 用 UTF-8 读取 `build\temp\logs\portable-selftest.log`
  - 看 `selftest.title` 是否为 `多串口测试台 V2`

结论：
- 打包优先用 `.bat` 入口；中文是否正常以 UTF-8 日志文件为准，不以 bat 控制台回显为准。
