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

## 目录结构

- `host/`：只在宿主机运行
- `container/`：只在容器里运行
- `examples/`：接入示例
- `host/state/`：运行时状态目录，存 token、pid、日志

当前结构：

```text
host-git-cred-proxy/
├── host/
│   ├── server.mjs
│   ├── start.sh
│   ├── status.sh
│   ├── stop.sh
│   └── state/
├── container/
│   ├── configure-git.sh
│   ├── git-credential-hostproxy
│   └── helper.mjs
├── examples/
│   ├── devcontainer.json
│   └── docker-compose.yml
├── package.json
└── README.md
```

## 默认行为

- 默认代理所有 `https` Git 凭证
- 默认监听 `127.0.0.1:18765`
- 容器默认通过 `http://host.docker.internal:18765` 访问宿主机
- token 生成到 `./host/state/token`

如果你还要代理 `http` 仓库：

```bash
GIT_CRED_PROXY_PROTOCOLS=https,http ./host/start.sh
```

## 使用

### 1. 宿主机启动代理

在宿主机进入这个项目目录：

```bash
./host/start.sh
```

查看状态：

```bash
./host/status.sh
```

### 2. 确保容器能访问这个项目目录

容器里的 Git helper 会直接引用这个项目目录下的脚本和 `host/state/token`。

所以你需要保证这个目录也能在容器里看到，例如：

- 宿主机和容器都共享 `/workspaces`
- 或者把这个目录单独挂载到容器内

### 3. 容器里配置 Git helper

全局生效：

```bash
/workspaces/host-git-cred-proxy/container/configure-git.sh
```

只作用于当前仓库：

```bash
cd /path/to/your/repo
/workspaces/host-git-cred-proxy/container/configure-git.sh --local
```

或者显式指定仓库：

```bash
/workspaces/host-git-cred-proxy/container/configure-git.sh --local --repo /workspaces/your-repo
```

### 4. 验证

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
./host/start.sh
```

### docker-compose

示例文件：`examples/docker-compose.yml`

使用前先设置宿主机项目路径：

```bash
export HOST_GIT_CRED_PROXY_DIR=/workspaces/host-git-cred-proxy
```

然后把示例复制到你的项目里：

```bash
cp /workspaces/host-git-cred-proxy/examples/docker-compose.yml ./docker-compose.yml
docker compose up -d
```

这个示例会：

- 把当前项目挂到容器内的 `/workspace`
- 把 `host-git-cred-proxy` 挂到容器内的 `/opt/host-git-cred-proxy`
- 容器启动时自动执行 `/opt/host-git-cred-proxy/container/configure-git.sh --global`

如果你在 OrbStack 里用 `network_mode: host`，也可以把 `GIT_CRED_PROXY_URL` 改成：

```bash
http://localhost:18765
```

### devcontainer

示例文件：`examples/devcontainer.json`

先在宿主机设置：

```bash
export HOST_GIT_CRED_PROXY_DIR=/workspaces/host-git-cred-proxy
```

然后复制到你的项目：

```bash
mkdir -p .devcontainer
cp /workspaces/host-git-cred-proxy/examples/devcontainer.json .devcontainer/devcontainer.json
```

这个示例会：

- 把当前工作区挂到容器内的 `/workspace`
- 额外挂载 `host-git-cred-proxy` 到 `/opt/host-git-cred-proxy`
- 在容器创建完成后自动执行 `/opt/host-git-cred-proxy/container/configure-git.sh --global`

如果你的本地路径不是 `/workspaces/host-git-cred-proxy`，只要把 `HOST_GIT_CRED_PROXY_DIR` 换成真实绝对路径即可。

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
- token 存在 `host/state/` 下，并通过 `.gitignore` 忽略
- 只要容器能读取这个目录，也就能读取 token
- 这适合你信任当前容器的开发场景，不适合不可信容器或多租户环境

## 停止代理

```bash
./host/stop.sh
```
