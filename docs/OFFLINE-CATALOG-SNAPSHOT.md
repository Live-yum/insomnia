# 已纳入 Git 的离线插件快照

## 实际文件和可用性

`vendor/offline-plugins/blobs/` 保存的是实际 npm `.tgz` 文件，不是下载链接、Git LFS 指针或子模块。插件入口、依赖锁文件、上游注册表完整性值、SHA-256、许可证元数据和异常清单均已保存。

2026-09-24 固定目录快照包含 **552 个插件条目、2,722 个压缩包，共 340,082,108 字节（约 324.3 MiB）**。

- **545 个 dependency-complete-unreviewed**：插件及锁定的 npm 依赖归档齐全，尚未逐项做安全和平台兼容性审查。
- **4 个 archive-only**：仅插件本体可归档。`insomnia-plugin-api-signature-fulll`、`insomnia-plugin-hmac-fulll`、`insomnia-plugin-hmac-ied` 依赖公开注册表中不可获取的签名包；`insomnia-plugin-codegen` 包含非注册表或未固定依赖。
- **3 个 unresolved**：`insomnia-plugin-gluwa-dev` 明确为 private/UNLICENSED，未自动重分发；`insomnia-plugin-ya-taxi` 和 `insomnia-plugin-yav` 的上游归档读取失败。

详细结果见 `REPORT.md`、`EXCEPTIONS.json` 和 `manifest.json`。**下载齐全不等于安全、兼容或能够脱离云服务运行。** 全目录不会自动启用。要求外部服务、原生模块或外部可执行程序的插件仍需独立评估。

应用内默认已集成两组实际可本地执行的源码插件：`insomnia-plugin-crypto@1.1.1-offline.1` 和 `insomnia-plugin-offline-crypto-tools@1.0.0`，位于 `packages/insomnia/src/vendor/`，同时进入请求/响应钩子和模板标签执行路径。它们会随可移植包提供，不需要目标机联网安装 npm 依赖。完整市场快照是管理员离线仓库，不是声称 552 个插件已全部启用和测试通过。

## 离线验证与准备

```sh
# 严格核对每个归档的 SHA-256、大小、上游完整性值以及配置/锁文件一致性
python3 scripts/offline/vendor_plugins.py verify

# 将依赖完整的插件展开到一个全新目录，不执行安装脚本或启动插件
python3 scripts/offline/vendor_plugins.py materialize --output ./review-win32 --target win32-x64
python3 scripts/offline/vendor_plugins.py materialize --output ./review-arm64 --target linux-arm64
```

`verify` 与 `materialize` 不联网。展开后也需要逐项审查权限、许可证、依赖和平台兼容性，才可由管理员将选定配置放入应用插件目录。

## 来源及修复记录

原归档复用了同仓库提交 `584b696ae1fd7a6115055ed7642622aadba45f50` 的插件快照，没有覆盖其并行应用改动。复核发现原目录抓取混入非插件条目、依赖记录顺序与已保存锁文件不一致，以及根目录 `* text eol=lf` 使部分 `.tgz` 在 Git 中发生换行替换。

本 PR 已将 `.tgz`、`.gz` 明确标记为二进制，并从原固定 URL 恢复 **688 个归档**；恢复必须同时匹配原 SHA-256、字节数和注册表完整性值，未更换版本或降低校验标准。依赖清单从原哈希验证通过、内容未改变的锁文件重新生成，按固定 HTML 的 `__NEXT_DATA__` 数据确定 552 个真实插件条目。

修复后的快照树为 `78d3453257c3120696c256496cea72446a6663ec`，修复及完整校验运行编号 `36030466626`。维护脚本 `restore-pinned-archives.py` 记录恢复逻辑；只有维护操作需要联网，正常构建和应用启动不会运行它。

在高安全环境，插件离线归档不能替代整个进程树的系统/网关出站白名单。
