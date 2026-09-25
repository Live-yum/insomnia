# Insomnia Offline — 全类别插件便携版

此分支基于已经合并的离线加密版本，保留其免厂商账号本地项目、禁用厂商更新/遥测、TLS 校验、Chromium sandbox 和 Windows secure wrapper，再加入公开 Plugin Hub 全类别目录的本地资源。

## 下载与启动

使用名称包含 `full-plugins-windows-x64-portable.zip` 或 `full-plugins-linux-arm64-portable.tar.gz` 的发行附件，不要把旧 `offline-build-20` 加密子集包误认成全类别插件包。

校验同一 Release 的 `.sha256`，完整解压到当前用户可写目录。Windows 双击 `Start-Insomnia-Offline.cmd`；Linux 以普通用户执行 `./start-insomnia-offline.sh`。保留整个目录，不要只复制 EXE。数据位于旁边的 `data/`，升级前备份并保留该目录。程序、插件和 Electron 运行时已随包提供，目标机器不需要 npm 安装。

Linux ARM64 是 AArch64，不是 ARM32。依赖兼容的 glibc、GTK/NSS/GBM/音频系统库和显示环境。Linux Chromium 需要可用的用户命名空间沙箱，或由管理员为包内 `chrome-sandbox` 正确配置 root 所有权与 4755 权限；不要加 `--no-sandbox`。移除压缩包中的 setuid 位是有意的，不把特权文件当作无须管理员审批的便携组件。没有捆绑 Git、Python、云厂商 CLI 或 AI 模型等外部可执行程序。

## 插件范围与启用

固定公开目录快照包括 552 个条目，545 个插件的本体和完整 npm 依赖已保存在仓库，2,722 个唯一压缩包。便携版携带这 545 个隔离依赖目录，不在启动时下载。构建逐文件对照 SHA-256，禁止缺少其中某个可准备目录却发布成功。实际数量及当前例外以同包 `validation/REPORT.md`、`EXCEPTIONS.json`、`BUILD-INFO.json` 为准。

已审核并静态内置的 Crypto（离线修订版）和 Offline Crypto Tools 保持启用。原始 Crypto 市场归档仍保留作来源记录，但不会以同名插件覆盖已审核实现。前者 AES-CBC 请求加密失败会中止，不静默发送明文；后者提供 AES-GCM、RSA-OAEP、HMAC 与 JWT payload 检视。JWT 检视不验证签名，CBC 不提供消息认证，GCM 协议需要服务端配套。

其他社区插件默认禁用，禁用时不执行入口。在 Preferences → Plugins 中按需要审核并启用。本地存在不是可信认证；一些旧插件缺少当前宿主元数据、需要安装脚本生成原生模块、操作系统程序、权限授权或外部服务，不能保证每个插件在两个平台都完整兼容。不得用关闭整个沙箱的方式批量运行它们。冲突插件应择一启用，不应一次性启用所有请求变换/认证钩子。

7 个目录例外明确列出：缺失 npm 依赖、需要另外审查的 Git 依赖、明确 UNLICENSED、损坏或 security-holding 发布包。不存在的依赖和未获授权的组件不会伪装成成功预置。云认证、云同步、团队/SSO、托管 AI 等仍需对应服务，下载客户端不能把服务端变为离线功能。

## 构建证据

同包 `validation/` 和 Release 的各平台 `*-validation.json` 记录真实源码 SHA、架构、归档 SHA-256、插件资源树摘要及桌面检查。构建区允许下载锁定的应用/Electron 构建依赖；插件 materialize 和程序运行不依赖外网。不是从空机器开始完全断网编译的 SDK 镜像。

桌面检查要求新数据目录免登录启动、界面创建本地项目及重载持久化、已内置 HMAC 通过认证模板桥执行、所有可发现社区插件默认禁用、Chromium 对真实可达回环服务的默认拒绝，以及用户原生 API 传输对同一回环服务的成功请求。Windows 在同一资源载荷上先执行 UI 自动化，再构造原有安全启动器并使用无调试参数的正常启动测试。Linux 将 Xvfb 和普通用户应用放在仅 loopback 的网络命名空间测试。

这些检查不是全部协议/全部第三方插件功能回归，更不是内网安全认证。正式部署必须对整个进程树设置默认拒绝、只允许批准业务目标/端口/DNS 的操作系统或网关出站策略，并在实际环境抓包验收。不要把生产请求、令牌、密钥或抓包上传公开仓库。

## 合并

整合分支 `offline/complete-portable` 基于已合并 PR #2 的 develop，保留加密实现并选择性纳入 PR #1 的资源改进。不要再直接把两个旧分支强行覆盖合并。以整合 PR 最新源码的质量检查和两个原生包/启动检查为准；失败时不管理员绕过、不强推 develop。合并后对合并提交重新构建发布，发布后核对两种附件、校验文件与源 SHA。源码合并和高安全现场验收是两项不同工作。
