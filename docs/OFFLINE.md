# Insomnia Offline / 内网便携版

This fork uses an account-free local workspace. It is not an activated cloud subscription and does not emulate one.

## 使用方式

- **Windows x64 / AMD64**：完整解压 ZIP，运行 `Start-Insomnia.cmd` 或 `Insomnia Offline.exe`。不要只拷贝 EXE。
- **Linux ARM64 / AArch64**：完整解压 `tar.gz`，运行 `./start-insomnia.sh`。这是 64 位 ARM，不是 ARMv7/armhf。
- 用户数据保存在便携目录的 `data/`。也可由管理员通过 `INSOMNIA_DATA_PATH` 指定安全的可写目录。默认不导入官方版的账户、缓存或用户数据，不注册系统级 URL 协议。
- 先退出应用再复制或备份 `data/`。请求、响应和环境可能含敏感信息；应设置严格目录权限并使用磁盘加密。
- 密钥使用本机操作系统的安全存储。安全存储不可用或 Linux 使用 `basic_text` 后端时会拒绝保存秘密，不回退到明文。复制目录到另一台机器不保证系统密钥可解密；事先安全保存本地 Vault Key，在新机器手动解锁。不要把密钥和数据副本放在一起。

## 预置插件及功能

`Crypto & Offline Toolkit` 是随源码静态编译的本地插件，不是在线插件安装器或某个未经确认的同名第三方插件。没有额外 npm 运行时依赖，没有首次运行下载。

包含 12 个模板标签：Hash（SHA-256/384/512、兼容性 MD5/SHA-1、运行时支持时的 SM3）、HMAC、AES-256-GCM 加密、AES-256-GCM 解密、JWT HS256 签名、JWT 解码（不验证签名）、TOTP、Base64、URL 组件编码/解码、UUID v4、32 字节随机十六进制值、JSON 格式化。

保留 Insomnia 本身的本地请求/集合、环境、OpenAPI 编辑、本地导入导出、脚本及测试、请求协议支持。本地和 Git 项目不再要求 Insomnia 登录。Git 操作仍需访问用户指定仓库；内网 Git 凭据仍由用户自行配置。应用不提供或伪造第三方凭据。

本地密钥库生成和校验不调用云端 SRP 服务；生成的 256 位随机密钥使用本机安全存储保护。重置密钥会删除此离线工作区已有的秘密环境变量，务必先备份并确认。

**不包含**云同步/团队协作/云组织权限/SSO、Kong Konnect、云端 Mock、在线插件市场、自动更新，以及依赖外部服务或额外模型文件的 AI 插件。云服务无法通过取消登录变成离线服务。没有批量预装整个第三方插件市场。附加插件只能由管理员审查源码、供应链和全部依赖后，通过本地插件目录部署；它们不属于本版默认的联网行为保证。

## 网络控制边界

1. Insomnia 云 API v1/v3 适配层直接失败，不保存或调用网络传输函数；旧配置不能重新启用云服务。
2. 不初始化更新器、Sentry、Segment、Customer.io，关闭在线插件安装、GitHub Star 查询、云端查询自动刷新以及拼写字典下载。
3. Electron 会话的 HTTP/HTTPS/WS/WSS 流量默认仅允许回环、RFC1918 IPv4、IPv6 ULA 和本地应用资源。管理员可用 `INSOMNIA_OFFLINE_ALLOWED_HOSTS=api.corp.example,git.corp.example` 允许**精确主机名**，不支持通配符。供应商服务域名仍禁止。
4. Electron 控制不是完整的进程级防火墙。用户主动请求使用原生 libcurl/gRPC/脚本等通道；代理、DNS、重定向、外部插件和子进程可能走不同网络栈。**高安全内网必须在操作系统/边界防火墙实施默认拒绝出网，只放行批准的内网目标**，不能仅凭 UI 的 Offline 标签认定零外联。
5. 发布测试检查无账户启动、本地项目创建、插件标签预置、原生 HTTP 回环请求和 Electron 启动日志中的供应商流量；不是完整渗透测试、全协议验证或隔离网安全认证。

## 可移植性与系统依赖

包内包含 Electron、应用及本地插件，不需要终端用户安装 Node.js/npm。它不是一个包含整个操作系统的静态二进制。

Linux ARM64 在 Ubuntu 22.04 ARM64 原生 runner 构建。目标机器仍需相容的 glibc、GTK/图形、NSS/音频等桌面运行库，以及可用的 Chromium sandbox 条件。请在同版本内网镜像上验收；缺少的系统库应由管理员提前准备离线系统安装包。不要通过永久添加 `--no-sandbox` 来绕过系统要求。

Windows 包没有代码签名证书，可能触发 SmartScreen/企业应用控制。应核对 `.sha256`、源代码提交和内部签名/准入流程，不要盲目关闭系统防护。

## 构建和发布

构建机可以联网获取锁定依赖及 Electron；发布成品运行时不进行 npm 安装。不要把“构建需要联网”与“运行需要供应商账号”混为一谈。

使用仓库 `.nvmrc` 指定的 Node 版本与 npm 11+：

```sh
npm ci --no-audit --no-fund
npm run type-check -w insomnia
npm exec -w insomnia -- vitest run src/common/offline.test.ts src/plugins/offline-toolkit.test.ts
npm run app-build
# 在 Windows x64 机器：
npm exec -w insomnia -- electron-builder --config electron-builder.offline.cjs --win --x64 --dir --publish never
# 在 Linux ARM64 机器：
npm exec -w insomnia -- electron-builder --config electron-builder.offline.cjs --linux --arm64 --dir --publish never
```

GitHub Actions 的 Offline portable release 工作流在两种原生架构执行打包和成品测试；任一必需步骤失败，不发布成品。发布为预发布版本，附源提交、SHA-256、插件清单和测试记录。生产隔离网仍需用户进行组织内部验收。
