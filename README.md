# Insomnia Offline — 内网离线版

这是 `Live-yum/insomnia` 的本地化分支，基于 Insomnia 开源源码。**本地工作区不需要 Insomnia/Kong 账号**。厂商登录、云同步、营销、统计、Sentry、更新检查和在线插件安装已禁用；不会伪造会员或把需要服务端的功能宣称为离线功能。

> 本仓库是可审查的离线候选实现，不是安全认证。请查看当前 Actions 检查结果；高安全部署仍须操作系统/网关出站白名单和现场验收。

## 已内置的加密解密功能

以下插件的实际源码、许可证和测试位于 [`packages/insomnia/src/vendor/`](packages/insomnia/src/vendor/)，静态打包进应用。运行目标机器不需要再下载插件或安装 npm 依赖。

| 内置插件 | 功能 |
| --- | --- |
| Crypto `1.1.1-offline.1` | AES-128/192/256-CBC 请求加密、响应解密；配置缺失或加密失败中止操作，不静默发送原文。 |
| Offline Crypto Tools `1.0.0` | AES-256-GCM、RSA-OAEP SHA-256、HMAC，以及明确标注“不验证签名”的 JWT payload 检视。 |

请求右键菜单提供 `Toggle Request Encryption` / `Toggle Response Decryption`；私有环境中配置 `crypto-alg`、`crypto-key`、`crypto-base64: true`。模板标签中搜索 `Offline AES-256-GCM`、`Offline RSA-OAEP SHA-256`、`Offline HMAC`。

CBC 是兼容模式，不提供消息认证；GCM 的封装格式要求服务端配套。**不要把真实密钥提交 Git。插件预置也不代表本地项目数据自动加密。** 详见 [使用、构建及部署说明](docs/OFFLINE-LOCAL.md)。

## 已下载到仓库的其他插件

[`vendor/offline-plugins/`](vendor/offline-plugins/) 保存固定目录快照的真实 npm 压缩包、依赖锁文件和完整性值，不是在线下载链接或 Git LFS 指针。

2026-09-24 快照记录 **552 个插件条目、2,722 个压缩包，约 324.3 MiB**：545 个条目的依赖已归档齐全；另有 4 个仅归档插件本体、3 个不可用，逐项列在 [`EXCEPTIONS.json`](vendor/offline-plugins/EXCEPTIONS.json)。**依赖归档齐全不代表已通过安全或平台兼容性审查；市场目录不会全部自动启用。** 应用默认集成的是上面的两组加密插件。

```sh
# 不联网、不执行插件，严格验证已提交归档和锁文件
python3 scripts/offline/vendor_plugins.py verify

# 在全新目录离线展开依赖完整的插件，供管理员审查；不执行安装脚本
python3 scripts/offline/vendor_plugins.py materialize --output ./review-win32 --target win32-x64
python3 scripts/offline/vendor_plugins.py materialize --output ./review-arm64 --target linux-arm64
```

参见 [插件快照、异常及校验说明](docs/OFFLINE-CATALOG-SNAPSHOT.md)。正常应用构建和启动不会执行维护用下载、迁移或修复脚本。

## Windows x64 / Linux arm64 可移植包

`Offline portable build` 工作流构建 Windows ZIP 和 Linux ARM64 tar.gz，并附带 SHA-256。两平台类型检查、构建及相应启动检查通过后，`develop` 的发布任务才创建预发布包。检查 Actions 和 Releases 的实际结果，**不能把源码导出成功当成成品构建成功**。

Windows 解压后使用 `Start-Insomnia-Offline.cmd`；Linux 使用 `./start-insomnia-offline.sh`。两者将数据放在包旁的 `data/`。直接启动二进制使用系统中独立的 `InsomniaOffline` 目录。Linux 仍需要兼容的桌面运行库和 Chromium sandbox；不要用 `--no-sandbox` 绕过。Windows 保留上游安全启动器，但不包含商业签名证书。

## 离线边界

本地项目、请求调试和预置密码学工具与厂商账号解耦。云协作、SSO、在线 AI、订阅管理以及 Git Sync 创建没有启用。Chromium 页面默认拒绝外部来源；管理员可通过 `INSOMNIA_OFFLINE_BROWSER_ORIGINS` 配置精确内网来源。

**用户请求引擎、脚本、用户插件和子进程不是由页面拦截器完全隔离的。** 请对整个进程树采用系统/网关出站白名单，并验证允许的 API、DNS、代理、重定向与异常路径。

## 上游与许可证

保留 [原上游 README](docs/UPSTREAM-README.md) 供参考，其中账号和云服务描述不适用于本离线分支。核心代码沿用 [Apache-2.0](LICENSE)；Crypto 保留 MIT 许可证；其他归档依各自许可证使用和再分发。
