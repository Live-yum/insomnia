# 离线版与全量插件预置

本分支针对 `Live-yum/insomnia` 的 Windows x64（AMD64）及 Linux arm64（AArch64）可移植构建。PR 合并目标是本仓库 `develop`，不是上游 Kong 仓库。

## “全量”的明确范围

覆盖本次公开 Insomnia Plugin Hub 目录快照中的**全部条目**，不只加密插件，不仅挑选热门插件，也包含主题、签名认证、编码转换、请求与响应处理、测试、导入导出和服务集成插件。`vendor/offline-plugins/plugin-hub.snapshot.html` 保存目录原始快照，`catalog-names.json` 保存从页面结构化数据提取的精确名称。

这是一个有版本和时间记录的目录快照，不是所有历史版本、未列入目录的私有插件或未来新插件的全集。新增目录条目需要经过一次新的受控构建，不会在内网客户端自动联网获取。

## 仓库保存的实际内容

- `vendor/offline-plugins/blobs/*.tgz`：真实的 npm 插件及依赖压缩包，按 SHA-256 内容寻址。不是只有插件名、下载地址或 npm 缓存。
- `vendor/offline-plugins/profiles/<id>/package-lock.json`：每个插件独立、固定版本的依赖树，避免不同插件强行共用不兼容依赖。
- `vendor/offline-plugins/manifest.json`：版本、来源、完整性值、SHA-256、包大小、许可证元数据、依赖、安装脚本及平台信息。
- `REPORT.md` / `EXCEPTIONS.json`：完整清单以及未能完整预置的条目。不能把失败项悄悄删除后声称全部成功。

压缩包保留原始源文件和许可证文件。对于明确标记 private/UNLICENSED 的包，下载器不会擅自纳入可再分发集合；许可证缺失等情况保留审查标记。内容哈希证明字节一致，不代表软件没有漏洞或恶意行为。

Git 二进制属性明确禁止对 `.tgz` 进行换行转换。校验同时覆盖 npm integrity、SHA-256、文件大小、锁文件和实际依赖清单。JSON 的属性排列顺序不影响依赖语义。

## 本地使用方式

构建程序在联网构建区生成快照并提交到仓库。之后资源展开使用**仓库内已有压缩包**，不调用 npm、不访问互联网、不执行插件安装脚本：

```bash
python scripts/offline/vendor_plugins.py verify
python scripts/offline/vendor_plugins.py materialize \
  --target linux-arm64 \
  --output packages/insomnia/offline-plugin-resources
```

Windows 构建使用 `--target win32-x64`。输出目录必须不存在，避免覆盖已有文件。构建配置把所有成功展开的独立插件目录放入应用 `resources/offline-plugins`；客户端直接读取本地 `catalog.json`，无需目标机器再次安装依赖。开发环境可通过 `INSOMNIA_OFFLINE_PLUGIN_DIR` 指定本地资源目录。

**预置不等于自动启用。** 所有未审核的第三方插件首次启动默认禁用；禁用时不执行其入口代码，也不执行用于发现导出的初始化代码。完成审核的插件可以在 Preferences → Plugins 中本地启用。不要一次启用全部插件：请求钩子可能相互覆盖，某些插件会执行外部命令或访问云服务。

## 已知边界

依赖归档完整的状态是 `dependency-complete-unreviewed`，不是“功能测试通过”。展开成功是 `materialized-unreviewed`，也不是“跨平台兼容”。以下情况仍需独立处理：

1. AWS、Google、GitHub、在线 Vault 等插件仍需要实际服务、账号或业务凭据。内网自托管服务须另行配置，不能因为客户端包已下载就宣称离线可用。
2. 原生模块、需要 postinstall 的插件，以及依赖 Python、Git、系统钥匙串或其他可执行文件的插件，可能需要特定平台准备。下载阶段不会盲目执行这些安装脚本。
3. 损坏的发布包、缺失或私有依赖、非 registry 的 Git 依赖、归档路径不满足 Windows 规则等，会留下明确的异常记录。
4. 本版应用使用真实本地组织，不伪造在线登录令牌或订阅。云同步、账号管理和 Git Sync 项目创建入口关闭；不能将其描述成全部云端付费服务已变为本地功能。

## 应用数据与网络

通过可移植启动脚本运行时，用户数据写入相邻 `data` 文件夹。直接启动应用则使用独立的 `InsomniaOffline` 用户数据目录。旧的 `INSOMNIA_DATA_PATH` 环境变量会被拒绝，避免混用原版账号数据库；迁移已有集合请使用导出、导入。

厂商 SDK、自动和手动更新、遥测、Sentry、营销初始化、云端事件流及在线插件安装在应用源码中禁用。浏览器侧只允许本地资源和显式批准的精确 origin。`INSOMNIA_OFFLINE_BROWSER_ORIGINS` 是管理员提供的 JSON 数组，供内网 IdP 等明确需求使用，不接受通配符。

用户主动发送的内网 API 请求仍需工作，因此这不是把所有网络协议一律封死。浏览器策略不能覆盖 Node、libcurl、启用的第三方插件、DNS 和子进程。高安全部署必须对完整进程树实施操作系统或网关出站白名单，并做抓包验收。不得通过关闭 TLS 校验、Electron 隔离或 Chromium sandbox 来绕过测试失败。

## Actions 与发布门槛

`offline-plugin-snapshot.yml` 在只读、无发布凭据的作业中下载及校验，再由独立写入作业提交数据文件和已审核的加载器改动。写入作业不运行第三方插件。后续 `offline-build.yml` 在 Windows x64、Linux arm64 原生 runner 分别校验仓库字节、展开本地插件、构建、类型检查及启动测试。

可移植包只在本平台构建和启动检查成功后上传，并附 SHA-256。Windows 保留上游安全启动包装器。未提供签名证书时属于未签名构建。Linux 仍需兼容的系统图形库及 sandbox 环境，不是跨所有 Linux 发行版的静态程序。系统钥匙串加密的凭据也不保证复制文件夹后即可跨机器解密。

**PR、源码提交、插件归档成功、编译成功、桌面测试成功、整机无外连验收，是不同状态。** 以具体 Actions 作业及报告为准；不能仅凭一个绿色下载作业就合并并发布为“完整安全离线版”。当前 PR 的说明记录尚未完成的门槛。
