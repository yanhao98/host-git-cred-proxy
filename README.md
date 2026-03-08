# host-git-cred-proxy

让 Docker 容器复用宿主机现有的 Git HTTPS 凭证。

适用场景：

- macOS + OrbStack / Docker Desktop
- 容器里使用 `https://...` Git remote
- 宿主机已经能通过自己的 `git credential` 正常取到凭证

工作方式：

- 宿主机启动一个只监听 `127.0.0.1` 的代理服务
- 代理服务内部调用宿主机自己的 `git credential fill/approve/reject`
- 容器里的 Git helper 把 Git 的凭证请求转发到宿主机代理

这意味着它代理的是“宿主机 Git 当前能取到的 HTTPS 凭证”，不是 macOS 全部系统密码。

## 文件

- `start.sh`：在宿主机后台启动代理
- `stop.sh`：停止代理
- `status.sh`：查看状态
- `server.mjs`：宿主机 HTTP 代理服务
- `git-credential-hostproxy`：容器里给 Git 用的 helper 入口
- `helper.mjs`：容器 helper 实现
- `configure-container.sh`：在容器里写入 Git 配置

## 默认行为

- 默认代理所有 `https` Git 凭证
- 默认监听 `127.0.0.1:18765`
- 容器默认通过 `http://host.docker.internal:18765` 访问宿主机
- token 生成到 `./state/token`

如果你还要代理 `http` 仓库：

```bash
GIT_CRED_PROXY_PROTOCOLS=https,http ./start.sh
```

## 使用

### 1. 宿主机启动代理

在宿主机进入这个项目目录：

```bash
./start.sh
```

查看状态：

```bash
./status.sh
```

### 2. 确保容器能访问这个项目目录

容器里的 Git helper 会直接引用这个项目目录下的脚本和 `state/token`。

所以你需要保证这个目录也能在容器里看到，例如：

- 宿主机和容器都共享 `/workspaces`
- 或者把这个目录单独挂载到容器内

### 3. 容器里配置 Git helper

全局生效：

```bash
/workspaces/host-git-cred-proxy/configure-container.sh
```

只作用于当前仓库：

```bash
cd /path/to/your/repo
/workspaces/host-git-cred-proxy/configure-container.sh --local
```

或者显式指定仓库：

```bash
/workspaces/host-git-cred-proxy/configure-container.sh --local --repo /workspaces/your-repo
```

### 4. 验证

```bash
git ls-remote origin
```

或者：

```bash
printf 'protocol=https\nhost=example.com\npath=owner/repo.git\n\n' | git credential fill
```

## 可选环境变量

- `GIT_CRED_PROXY_HOST`：宿主机监听地址，默认 `127.0.0.1`
- `GIT_CRED_PROXY_PORT`：宿主机监听端口，默认 `18765`
- `GIT_CRED_PROXY_PUBLIC_URL`：容器访问地址，默认 `http://host.docker.internal:<port>`
- `GIT_CRED_PROXY_PROTOCOLS`：允许代理的协议列表，默认 `https`
- `GIT_CRED_PROXY_ALLOWED_HOSTS`：可选，限制允许代理的 host，逗号分隔
- `GIT_CRED_PROXY_URL`：容器 helper 访问代理的地址，默认 `http://host.docker.internal:18765`
- `GIT_CRED_PROXY_TOKEN`：可选，直接传 token，优先于 token 文件
- `GIT_CRED_PROXY_TOKEN_FILE`：可选，自定义 token 文件路径
- `GIT_CRED_PROXY_RUNTIME`：可选，显式指定 `bun` 或 `node`

## 安全说明

- 服务端默认只监听 `127.0.0.1`
- token 存在项目目录下，并通过 `.gitignore` 忽略
- 只要容器能读取这个目录，也就能读取 token
- 这适合你信任当前容器的开发场景，不适合不可信容器或多租户环境

## 停止代理

```bash
./stop.sh
```
