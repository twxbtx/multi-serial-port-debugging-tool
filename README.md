# Serial Assistant

基于 `Electron + React + TypeScript` 的多串口调试助手桌面应用原型，使用Codex开发，核心功能：一个视窗多个串口窗口+录制测试动作回放做周期性自动化测试。

## 一键打包免安装 EXE

Windows 下直接双击：

- [build-portable.bat](C:/Users/senasic/Documents/BH2%20WBMS芯片设计和软件开发/serial-assistant/build-portable.bat)

它会自动：

1. 检查 `node_modules`
2. 执行前端构建
3. 打包生成免安装便携版 `EXE`

也可以命令行执行：

```powershell
.\build-portable.ps1
```

或者：

```powershell
npm.cmd run package:portable
```

打包输出目录：

- `release\`

## 开发运行

```powershell
npm.cmd install
npm.cmd run dev
```

常用命令：

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run package:dir
```

## 当前已完成

- 多串口会话窗口
- 每个窗口独立串口参数
- 收发日志颜色区分
- 关键字过滤
- `JSON / CSV` 日志导出
- 日志导入回放
- 每个窗口自定义命令
- 动作记忆
- 周期执行与定时停止
- 多主题切换
- 串口文本数值提取后实时波形刷新
- `XMODEM / YMODEM` 文件发送入口
- Electron 桌面版打包配置
- Windows 一键便携版 EXE 打包脚本

## 待实现 / 待加强

- 动作脚本导入导出
- 关键字高亮规则可配置
- 更完整的发送/接收十六进制视图
- 波形通道选择、缩放、暂停、清屏
- `XMODEM / YMODEM` 进度细节、重传统计、异常恢复提示
- 真正面向量产使用的会话配置模板
- 导出回放文件格式进一步标准化
- 打包图标、版本信息、签名等发布细节

## 需要真机实测的部分

这些功能本地逻辑已经接上，但必须连真实串口设备验证：

- 串口枚举是否覆盖你常用 USB 转串口芯片
- 不同波特率/校验位/停止位组合的稳定性
- 高速连续接收时的丢包、卡顿、内存增长
- 多串口同时打开时的资源占用
- 动作录制后周期执行的真实时序误差
- 波形数据在高频刷新下的流畅度
- `XMODEM / YMODEM` 与目标设备的握手兼容性
- 文件传输失败、超时、中断、重连后的恢复行为
- 目标板日志包含中文、HEX、二进制混合数据时的显示效果

## 本次验证

已完成：

- `npm.cmd run lint`
- `npm.cmd run build`
- 本地页面实际打开验证
- 新建串口窗口 UI 验证

未完成：

- 真实串口硬件联调
- 真机协议传输验证
- 便携版 EXE 在目标机器上的冷启动验证
