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

推荐的分发/运行方式是：

- 优先直接执行 `host-git-cred-proxy` 二进制命令
- 如果仓库已经发布 release tarball，可以直接解压后运行
- Homebrew 相关公式与自动化已在仓库中，但是否可直接 `brew install` 取决于 tap / release 是否已经发布
- 仅在开发/调试源码仓库时，才使用 `./host/start.sh` 这类辅助脚本

## 项目结构

- `host/src/`：宿主机服务本体、CLI、管理 API、状态管理与发布时运行逻辑
- `host/ui/`：本地管理面板前端（React + Vite）
- `host/`：宿主机启动/停止/状态 shell 包装脚本与运行时状态目录
- `container/`：容器内安装脚本、Git helper、配置脚本
- `examples/`：`docker-compose` / `devcontainer` 接入示例
- `scripts/`：发布、公式生成、workflow 验证等自动化脚本
- `tests/`：host、container、release、UI 相关自动化测试
- `packaging/`：分发相关模板（例如 Homebrew formula 模板）

当前仓库的大致结构：

```text
host-git-cred-proxy/
├── host/
│   ├── src/
│   ├── ui/
│   ├── start.sh
│   ├── status.sh
│   ├── stop.sh
│   └── state/
├── container/
├── examples/
├── packaging/
├── scripts/
├── tests/
├── package.json
└── README.md
```

## 本地管理面板

项目现在包含一个本地 Web 管理面板，用来查看服务状态和辅助配置。当前主要页面包括：

- `Overview`：运行状态、监听地址、公开地址、token 路径等概览信息
- `Setup`：本地安装、容器接入、compose / devcontainer 片段
- `Requests`：脱敏请求记录轮询视图
- `Logs`：日志轮询视图与截断提示
- `Settings`：配置保存、重启跳转、token rotate

这个面板是本地开发/运维辅助工具，不是远程管理入口。

## 默认行为

- 默认代理所有 `https` Git 凭证
- 默认监听 `127.0.0.1:18765`
- 容器默认通过 `http://host.docker.internal:18765` 访问宿主机
- 二进制运行时，默认 state 目录在 macOS 上是 `~/Library/Application Support/host-git-cred-proxy`
- token 默认生成到 `<stateDir>/token`

如果你还要代理 `http` 仓库：

```bash
GIT_CRED_PROXY_PROTOCOLS=https,http host-git-cred-proxy start
```

如果你是在源码仓库里开发调试，也可以继续使用：

```bash
GIT_CRED_PROXY_PROTOCOLS=https,http ./host/start.sh
```

## 使用

### 1. 推荐：直接执行二进制

如果你拿到的是 release tarball，请解压后保留 `bin/` 和 `share/host-git-cred-proxy/` 的相对目录结构。

例如：

```bash
tar -xzf host-git-cred-proxy-darwin-arm64.tar.gz
export PATH="$PWD/bin:$PATH"
host-git-cred-proxy start
```

查看状态：

```bash
host-git-cred-proxy status
```

打开本地面板：

```bash
host-git-cred-proxy open
```

停止服务：

```bash
host-git-cred-proxy stop
```

如果你想把状态目录放到其他位置：

```bash
export GIT_CRED_PROXY_STATE_DIR=/absolute/path/to/state-dir
host-git-cred-proxy start
```

### 2. 开发态：从源码仓库启动代理

在宿主机进入这个项目目录：

```bash
./host/start.sh
```

查看状态：

```bash
./host/status.sh
```

`./host/start.sh` 仍然可用，但它主要是源码仓库里的开发便利入口，不是推荐的最终分发方式。

### 3. 把宿主机 token 目录挂载到容器

容器只需要读取 token 目录，不需要挂载 `host-git-cred-proxy` 源码仓库。

推荐把宿主机 state 目录挂载到容器内固定路径 `/run/host-git-cred-proxy`，
这样 helper 默认就会读取 `/run/host-git-cred-proxy/token`。

请挂载目录（而不是单个 token 文件），这样 token 轮换后容器里仍能读到新文件。

常见情况：

- 如果你是通过源码仓库里的 `./host/start.sh` 运行，state 目录通常是 `<repo>/host/state`
- 如果你是通过已安装二进制运行，state 目录通常是 `~/Library/Application Support/host-git-cred-proxy`

### 4. 容器里安装并配置 Git helper

```bash
curl -fsSL http://host.docker.internal:18765/container/install.sh | sh
configure-git.sh --global
```

如果你想只作用于当前仓库：

```bash
configure-git.sh --local
```

或者显式指定仓库：

```bash
configure-git.sh --local --repo /path/to/your-repo
```

如果 `/usr/local/bin` 不可写，请使用 `INSTALL_DIR` 覆盖安装目录：

```bash
INSTALL_DIR="$HOME/.local/bin" curl -fsSL http://host.docker.internal:18765/container/install.sh | sh
"$HOME/.local/bin/configure-git.sh" --global
export PATH="$HOME/.local/bin:$PATH"
```

如果你把宿主机服务的 `publicUrl` 改成了其他地址（例如 OrbStack `network_mode: host` 下使用 `http://localhost:18765`），请同时覆盖安装地址和运行地址：

```bash
export GIT_CRED_PROXY_INSTALL_URL=http://localhost:18765
export GIT_CRED_PROXY_URL=http://localhost:18765
curl -fsSL "$GIT_CRED_PROXY_INSTALL_URL/container/install.sh" | sh
```

### 5. 验证

```bash
git ls-remote origin
```

或者：

```bash
printf 'protocol=https\nhost=example.com\npath=owner/repo.git\n\n' | git credential fill
```

## 接入示例

这两个示例都假设你已经在宿主机启动了代理：

```bash
host-git-cred-proxy start
```

如果你是在源码仓库里开发调试，也可以继续使用：

```bash
./host/start.sh
```

### docker-compose

示例文件：`examples/docker-compose.yml`

使用前先设置 token 目录和容器访问地址：

```bash
export HOST_GIT_CRED_PROXY_TOKEN_DIR=/absolute/path/to/state-dir
export GIT_CRED_PROXY_INSTALL_URL=http://host.docker.internal:18765
export GIT_CRED_PROXY_URL=http://host.docker.internal:18765
```

如果你是源码仓库启动，`HOST_GIT_CRED_PROXY_TOKEN_DIR` 往往类似 `<repo>/host/state`；
如果你是安装后的二进制运行，通常类似 `~/Library/Application Support/host-git-cred-proxy`。

然后把示例复制到你的项目里：

```bash
cp examples/docker-compose.yml /path/to/your-project/docker-compose.yml
docker compose up -d
```

这个示例会：

- 把当前项目挂到容器内的 `/workspace`
- 把 token 目录挂到容器内的 `/run/host-git-cred-proxy`（只读）
- 容器启动时先执行 `curl .../container/install.sh | sh`，再执行 `configure-git.sh --global`

如果你在 OrbStack 里用 `network_mode: host`，把 `GIT_CRED_PROXY_INSTALL_URL` 和 `GIT_CRED_PROXY_URL` 都改成：

```bash
http://localhost:18765
```

### devcontainer

示例文件：`examples/devcontainer.json`

先在宿主机设置：

```bash
export HOST_GIT_CRED_PROXY_TOKEN_DIR=/absolute/path/to/state-dir
```

然后复制到你的项目：

```bash
mkdir -p .devcontainer
cp examples/devcontainer.json .devcontainer/devcontainer.json
```

这个示例会：

- 把当前工作区挂到容器内的 `/workspace`
- 挂载 token 目录到 `/run/host-git-cred-proxy`
- 在容器创建完成后自动执行 `curl .../container/install.sh | sh` + `configure-git.sh --global`

如果你的服务 `publicUrl` 不是默认值，请在 `devcontainer.json` 里同步更新 `GIT_CRED_PROXY_INSTALL_URL` 和 `GIT_CRED_PROXY_URL`。

## 可选环境变量

- `GIT_CRED_PROXY_HOST`：宿主机监听地址，默认 `127.0.0.1`
- `GIT_CRED_PROXY_PORT`：宿主机监听端口，默认 `18765`
- `GIT_CRED_PROXY_PUBLIC_URL`：容器访问地址，默认 `http://host.docker.internal:<port>`
- `GIT_CRED_PROXY_PROTOCOLS`：允许代理的协议列表，默认 `https`
- `GIT_CRED_PROXY_ALLOWED_HOSTS`：可选，限制允许代理的 host，逗号分隔
- `GIT_CRED_PROXY_URL`：容器 helper 访问代理的地址，默认 `http://host.docker.internal:18765`
- `GIT_CRED_PROXY_INSTALL_URL`：容器下载 `install.sh` 的地址，建议与 `GIT_CRED_PROXY_URL` 保持一致
- `GIT_CRED_PROXY_TOKEN`：可选，直接传 token，优先于 token 文件
- `GIT_CRED_PROXY_TOKEN_FILE`：可选，自定义 token 文件路径
- `GIT_CRED_PROXY_RUNTIME`：可选，显式指定 `bun` 或 `node`
- `HOST_GIT_CRED_PROXY_TOKEN_DIR`：示例编排文件使用的宿主机 state 目录（挂载到 `/run/host-git-cred-proxy`）

## 构建与分发

项目当前已经包含面向发布的脚本与 workflow，主要用于生成 macOS 发布产物和后续分发自动化：

- `bun run package:release`：生成 `dist/releases/` 下的 Darwin tarballs 和 `checksums.txt`
- `bun run smoke:tarball`：验证 tarball 结构；在非 macOS 环境下只做结构校验，不会伪装成原生 Darwin 运行验证
- `bun run smoke:brew`：生成 Homebrew formula 并尝试本地 smoke；如果当前环境缺少 `brew`，会显式失败并写出阻塞证据

仓库里还包含：

- `.github/workflows/release.yml`：tag 驱动的 GitHub Release workflow
- `packaging/homebrew/formula.rb.template`：Homebrew formula 模板

注意：仓库中已经有 release / Homebrew 相关脚本与自动化配置，但这并不等于任意时刻都已经存在可直接下载的 release 资产或可直接安装的 tap。请以当前仓库的 Releases / tap 发布状态为准。

## 安全说明

- 服务端默认只监听 `127.0.0.1`
- token 存在当前 state 目录下；源码仓库启动时通常是 `host/state/`，二进制运行时通常是系统默认 state 目录
- 只要容器能读取这个目录，也就能读取 token
- 这适合你信任当前容器的开发场景，不适合不可信容器或多租户环境

## 停止代理

```bash
host-git-cred-proxy stop
```

如果你是在源码仓库里开发调试，也可以继续使用：

```bash
./host/stop.sh
```
