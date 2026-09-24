# Insomnia Offline 内网版

本分支将应用源码改为本地优先、无需厂商账号。云端协作、云同步、在线 AI、订阅管理和厂商登录不再启用，不伪造会员或服务端权限。

## 已随源码内置的插件

代码位于 `packages/insomnia/src/vendor/`，通过 `common/offline-plugins.ts` 静态打包，同时接入请求/响应钩子和模板标签加载。运行目标机器不需要 npm、插件市场、GitHub token 或额外插件下载。

- **Crypto 1.1.1-offline.1**：来自 zaigr/insomnia-plugin-crypto 1.1.1 的固定 commit `769994ff8976233ead2e94a9054b3b4a72171485`。MIT，保留 LICENSE、原始测试和 UPSTREAM.json 中的文件校验值。支持 AES-128/192/256-CBC 请求加密、响应解密；密钥为 16/24/32 字节 UTF-8 字符串；协议为 Base64(随机 16 字节 IV + ciphertext)。加密配置缺失或失败会抛错，不再只提示后继续发送。为防止二进制字符串重编码，只接受 `crypto-base64: true`。CBC 不提供消息认证，仅用于兼容已有服务，仍应使用 HTTPS。
- **Offline Crypto Tools 1.0.0**：本 fork 的 Apache-2.0 实现，仅调用 Node 标准密码学库；提供 AES-256-GCM、RSA-OAEP SHA-256、HMAC SHA-256/384/512、JWT payload 检视。AES-GCM 密钥是 Base64 编码的 32 随机字节，输出格式 Base64(`IG1` + 12 字节 nonce + 16 字节 tag + ciphertext)，要求服务端兼容此格式。RSA 最少 2048 位，用于短消息。JWT 检视明确 **不验证签名、签发方、受众或有效期**，不能用作鉴权。

在请求右键菜单选择 **Toggle Request Encryption** / **Toggle Response Decryption**，并在私有环境中配置 `crypto-alg`、`crypto-key`、`crypto-base64`。只有明确启用的请求才自动加解密。模板编辑器中查找 `Offline AES-256-GCM`、`Offline RSA-OAEP SHA-256`、`Offline HMAC`、`Offline JWT payload (NOT verified)`。

不要把真实密钥提交 Git。插件预置不等于项目数据已加密；环境、请求、响应和数据目录仍需磁盘加密、备份及访问控制。新旧机器的系统密钥存储也不保证凭据可直接迁移。

市场插件快照工具是独立的维护工具，不在应用启动或正常构建中执行。未经审查的插件不能因为已下载就自动启用；云服务、外部可执行程序和本机模块无法通过“下载一个插件”变成纯离线功能。本次静态预加载范围为上列两组插件及原有内置功能，不宣称全部市场插件已经兼容测试。

## 构建与可移植包

使用 `.nvmrc` 指定的 Node 和 package-lock.json。在受控联网构建区运行 `npm ci`、`npm run type-check -w insomnia`、`npm run app-build`，再从 `packages/insomnia` 运行 electron-builder，配置为 `electron-builder.offline.cjs`。正常构建不运行源码迁移或在线插件下载脚本。

GitHub Actions 分别使用原生 Windows x64、Linux arm64 runner。构建产物是 Windows ZIP 和 Linux tar.gz，不是安装程序，也不是支持所有 Linux 发行版的静态二进制。Linux 需要兼容的 glibc/GTK/NSS 等桌面运行库及可用的 Chromium sandbox；不要以 `--no-sandbox` 绕过。Windows 保留上游 secure wrapper，但本 fork 不包含作者的商业签名证书。

解压到可写目录后，Windows 运行 `Start-Insomnia-Offline.cmd`，Linux 运行 `./start-insomnia-offline.sh`。启动脚本把数据存放在包目录的 `data/`。直接运行二进制仍使用独立的系统 `InsomniaOffline` 数据目录。可以用 `INSOMNIA_OFFLINE_DATA_PATH` 指定独立目录；禁止复用原版 `INSOMNIA_DATA_PATH` 或带云账号会话的数据库。通过本地导入迁移已有集合。

## 安全边界与验收

厂商 SDK、更新、统计、Sentry、营销、云事件流和在线安装入口已在源头关闭。Chromium 会话默认只允许应用及本地资源；管理员可以通过 JSON 数组 `INSOMNIA_OFFLINE_BROWSER_ORIGINS` 明确允许精确的内网来源，例如 `["https://idp.corp:8443"]`。不支持域名通配符。

**这不是进程树出站防火墙。** 用户请求的 libcurl、gRPC、WebSocket、脚本、用户插件和子进程仍可能访问指定目标。必须在 OS/网络层对整个进程树执行默认拒绝，只允许批准的 IP、端口与 DNS；评估代理/PAC、重定向、DNS 变化和外部程序。不能只按 Chromium 日志判定零外连。

发布前检查：全新目录首次启动、重启后项目保留、本地项目增删、集合导入导出、HTTP/GraphQL/gRPC/WS/SSE、脚本、测试、加解密失败路径、更新按钮、空闲运行与退出。保留两平台构建/测试日志和包 SHA256，现场抓包覆盖整个进程树。自动化 smoke 仅覆盖其中一部分，不是安全认证。
