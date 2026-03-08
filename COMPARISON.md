# host-git-cred-proxy vs [git-credential-forwarder](https://github.com/sam-mfb/git-credential-forwarder)

两个项目解决同一个问题：让 Docker 容器复用宿主机的 Git HTTPS 凭证。

## 功能对比

| 特性 | host-git-cred-proxy | git-credential-forwarder |
|---|---|---|
| 语言 | JavaScript (mjs) | TypeScript |
| 运行时 | Node.js / Bun | Node.js |
| 安装方式 | 直接使用脚本，无需安装 | `npm install -g` |
| 认证机制 | Token 鉴权 | 无 |
| 协议过滤 | 支持（默认仅 https） | 不支持 |
| Host 白名单 | 支持 `GIT_CRED_PROXY_ALLOWED_HOSTS` | 不支持 |
| Unix Socket | 不支持 | 支持（macOS 下不可用） |
| 生命周期管理 | start/stop/status 脚本 | 手动启停 |
| 容器配置脚本 | `container/configure-git.sh` 一键配置 | 手动编辑 gitconfig |
| 后台运行 | `start.sh` 自动后台运行 | 前台运行，需保持终端 |
| 依赖 | 零依赖 | npm 包，有构建产物 |

## 安全性对比

| 安全特性 | host-git-cred-proxy | git-credential-forwarder |
|---|---|---|
| 请求认证 | Token（自动生成） | 无 |
| 协议限制 | 可配置，默认仅 https | 无限制 |
| Host 限制 | 可配置白名单 | 无限制 |
| 监听地址 | 127.0.0.1 | localhost |
| 凭证存储 | 仅内存 | 仅内存 |

`git-credential-forwarder` 作者在文档中明确指出：服务端连接未加密、无认证保护，任何能访问 localhost 的进程都可以请求凭证。

`host-git-cred-proxy` 通过 token 鉴权 + 协议过滤 + host 白名单提供了多层防护。

## 易用性对比

### host-git-cred-proxy

```bash
# 宿主机
./host/start.sh

# 容器
/workspaces/host-git-cred-proxy/container/configure-git.sh
```

### git-credential-forwarder

```bash
# 宿主机
npm install -g git-credential-forwarder
gcf-server  # 前台运行，需保持终端

# 容器
npm install -g git-credential-forwarder
export GIT_CREDENTIAL_FORWARDER_SERVER="host.docker.internal:PORT"
git config --global credential.helper '!f() { gcf-client $*; }; f'
```

## 总结

- **host-git-cred-proxy** 更安全（token 鉴权、协议/host 白名单）、更易用（脚本化管理、一键配置）、零依赖
- **git-credential-forwarder** 支持 Unix socket（但 macOS 不可用）、通过 npm 分发
