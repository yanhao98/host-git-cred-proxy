# host-git-cred-proxy 下一阶段实施文档

## 1. 目标

这一轮改造的目标不是继续优化“仓库里的几个脚本”，而是把项目升级成一个安装后可直接使用的本地产品：

- 宿主机安装后可直接启动，不要求先 `git clone` 本仓库才能使用
- 宿主机提供本地 Web 面板，用来查看状态、配置代理、查看日志和接入说明
- 代理接口和 Web 面板共用一个端口，但必须做严格的路由和权限隔离
- 容器侧不再依赖本仓库目录，也不再依赖 `node` / `bun`
- 首发目标平台为 macOS，重点兼容 Docker Desktop / OrbStack

## 2. 已拍板的技术决策

以下内容作为实现基线，不再在实现阶段反复讨论：

- 宿主机服务端：`Bun + Elysia + TypeScript`
- Web UI：`React + Vite + TypeScript`
- 端口策略：单端口，默认 `127.0.0.1:18765`
- 进程形态：一个宿主机服务，同时提供 UI、管理 API、代理 API、容器 helper 下载入口
- 发布形态：`Bun 编译的 macOS 二进制 + GitHub Releases + Homebrew tap`
- 容器 helper：`POSIX sh + curl`，不依赖 `node` / `bun`
- 当前脚本保留一段过渡期，作为兼容入口；长期目标是以二进制 CLI 为主

## 3. 当前实现的主要问题

当前版本能工作，但它的使用方式仍然是“源码仓库型工具”，主要问题如下：

- `host/start.sh` 把运行状态写到仓库里的 `host/state/`
- `container/configure-git.sh` 把 Git helper 直接指向仓库内脚本路径
- `container/helper.mjs` 默认从仓库相对路径读取 token
- 容器 helper 仍然依赖 `node` 或 `bun`
- 用户没有宿主机 UI，只能通过脚本和日志排查问题

这导致当前体验更像“开发者自己维护脚本”，而不是“安装后直接用的本地工具”。

## 4. 目标产品形态

目标使用流程如下：

### 宿主机

```bash
brew install host-git-cred-proxy
host-git-cred-proxy start
host-git-cred-proxy open
```

用户打开面板后可以：

- 查看当前运行状态、监听地址、容器接入地址
- 修改协议白名单、host 白名单、端口等配置
- 轮换 proxy token
- 查看最近请求和运行日志
- 直接复制 `docker-compose` / `devcontainer` 接入片段

### 容器

```bash
curl -fsSL http://host.docker.internal:18765/container/install.sh | sh
git-credential-hostproxy configure --global
git clone https://...
```

注：最终 helper 是否保留 `configure` 子命令，还是继续提供独立 `configure-git.sh`，实现阶段可选其一；但容器侧必须做到“无 Bun/Node 依赖”。

## 5. MVP 范围

这一轮只做最关键的可用能力：

- 可启动、可停止、可查看状态的宿主机二进制 CLI
- 基于同一端口的 Web 面板
- 与当前行为兼容的 Git credential 代理能力
- 容器侧 shell helper 与安装脚本
- 从源码仓库状态目录迁移到稳定的用户态目录
- GitHub Releases 二进制产物
- Homebrew tap 安装方式

以下能力明确不属于 MVP：

- Windows 支持
- Linux 作为一等发布目标
- 远程管理面板
- 多用户 / 多租户隔离
- 自动开机启动（可作为后续增强）
- UI 实时推送（MVP 先用轮询，不先上 SSE / WebSocket）

## 6. 总体架构

### 6.1 单端口策略

单端口可以做，而且这一轮就按单端口实现。

默认监听：

- `host = 127.0.0.1`
- `port = 18765`

同一个 Elysia 服务负责四类内容：

1. 代理 API
2. 管理 API
3. Web UI 静态资源
4. 容器 helper 下载入口

但“同端口”不等于“同权限”。必须按路由分层。

### 6.2 路由分层

#### A. 代理 API（容器可访问）

- `GET /healthz`
- `POST /fill`
- `POST /approve`
- `POST /reject`

规则：

- 所有 `POST` 代理路由都必须校验 `Authorization: Bearer <proxy-token>`
- 保留当前请求体格式，继续直接对接 `git credential fill/approve/reject`
- 保留当前语义：缺失凭证时，`fill` 返回 `200` 空 body，而不是直接报错

#### B. 容器 helper 下载入口（容器可访问）

- `GET /container/install.sh`
- `GET /container/configure-git.sh`
- `GET /container/git-credential-hostproxy`

这些路由用于让容器直接从宿主机服务下载 helper，不要求预先挂载本仓库，也不要求容器能访问 GitHub Releases。

#### C. 本地 UI（仅 loopback 可访问）

- `GET /`
- `GET /assets/*`

#### D. 本地管理 API（仅 loopback 可访问）

- `GET /api/admin/bootstrap`
- `GET /api/admin/status`
- `GET /api/admin/config`
- `POST /api/admin/config`
- `POST /api/admin/restart`
- `POST /api/admin/token/rotate`
- `GET /api/admin/requests`
- `GET /api/admin/logs`

### 6.3 本地路由访问规则

UI 和管理 API 必须同时满足以下条件：

- 请求来源是 loopback（`127.0.0.1`、`::1`，以及规范化后的 loopback 地址）
- 非 GET 的管理 API 必须校验 `Origin`
- 非 GET 的管理 API 必须带 `X-Admin-Nonce`

其中：

- `proxy-token` 专门给容器代理 API 用
- `admin-nonce` 专门给浏览器管理操作用
- 两者绝不能复用

`admin-nonce` 可以在服务启动时生成，仅保存在内存中；前端通过 `GET /api/admin/bootstrap` 获取。

## 7. 进程模型与 CLI 设计

最终 CLI 名称：

```bash
host-git-cred-proxy
```

建议支持以下命令：

- `host-git-cred-proxy start`：后台启动服务，打印 panel URL 和 state dir
- `host-git-cred-proxy serve`：前台运行服务，供开发和内部启动使用
- `host-git-cred-proxy stop`：停止后台服务
- `host-git-cred-proxy status`：显示运行状态、pid、URL、健康检查结果
- `host-git-cred-proxy open`：在默认浏览器打开面板
- `host-git-cred-proxy rotate-token`：轮换 proxy token

实现要求：

- `start` 通过后台拉起 `serve`
- 需要 `server.pid`
- 需要基础健康检查，避免启动假成功
- 保留当前 `start/stop/status` 的使用心智

过渡期兼容策略：

- `host/start.sh` 调用新 CLI 的 `start`
- `host/stop.sh` 调用新 CLI 的 `stop`
- `host/status.sh` 调用新 CLI 的 `status`

这样可以降低文档迁移和现有用户切换成本。

## 8. 状态目录设计

必须把状态目录从仓库移走。

默认状态目录：

- macOS：`~/Library/Application Support/host-git-cred-proxy`
- 其他系统的开发环境回退：`~/.local/state/host-git-cred-proxy`

允许覆盖：

- 环境变量：`GIT_CRED_PROXY_STATE_DIR`

状态目录内文件：

- `config.json`
- `token`
- `server.pid`
- `server.log`
- `requests.ndjson`
- `runtime.json`

文件职责：

- `config.json`：持久配置
- `token`：代理 API 的 bearer token
- `server.pid`：后台进程 pid
- `server.log`：服务运行日志
- `requests.ndjson`：脱敏后的请求历史
- `runtime.json`：当前运行实例的时间、版本、面板地址等运行态信息

## 9. 配置模型

`config.json` 建议采用如下结构：

```json
{
  "host": "127.0.0.1",
  "port": 18765,
  "publicUrl": "http://host.docker.internal:18765",
  "protocols": ["https"],
  "allowedHosts": [],
  "requestHistoryLimit": 200,
  "openBrowserOnStart": false
}
```

规则：

- `host` 默认仍为 `127.0.0.1`
- `publicUrl` 允许手动覆盖，不从 `host` 自动推导
- `protocols` 默认只允许 `https`
- `allowedHosts` 为空表示不限制 host
- `requestHistoryLimit` 控制 UI 展示和清理上限，不要求无限累积

对外仍保留兼容环境变量：

- `GIT_CRED_PROXY_HOST`
- `GIT_CRED_PROXY_PORT`
- `GIT_CRED_PROXY_PUBLIC_URL`
- `GIT_CRED_PROXY_PROTOCOLS`
- `GIT_CRED_PROXY_ALLOWED_HOSTS`
- `GIT_CRED_PROXY_STATE_DIR`

优先级建议：

1. CLI flag（如果后续加入）
2. 环境变量
3. `config.json`
4. 内置默认值

## 10. 代理核心实现要求

代理核心继续复用当前项目已经验证过的 Git credential 行为，但要迁移到新的 Bun/Elysia 服务内。

必须保留的行为：

- 请求体仍然是 Git credential 的 `key=value` 文本格式
- body 限制保留 64 KiB
- `fill -> git credential fill`
- `approve -> git credential approve`
- `reject -> git credential reject`
- `GIT_TERMINAL_PROMPT=0`
- 对缺失凭证的 `fill` 做空返回兼容，而不是把 stderr 原样返回给容器

新增要求：

- 每次代理请求都记录脱敏后的审计事件
- 审计事件不得包含 `username`、`password`、`oauth token`、`Authorization header`
- 记录项只保留最小必要信息：时间、action、protocol、host、path、结果、状态码、耗时

推荐的事件结构：

```json
{
  "time": "2026-03-09T10:00:00.000Z",
  "action": "fill",
  "protocol": "https",
  "host": "github.com",
  "path": "owner/repo.git",
  "statusCode": 200,
  "outcome": "ok",
  "durationMs": 12
}
```

`outcome` 约定值建议包括：

- `ok`
- `empty`
- `denied`
- `bad_request`
- `error`

## 11. Web 面板设计

Web 面板使用 `React + Vite`，构建产物由宿主机服务直接托管。

不做 SSR，不额外引入第二个 Web 服务。

MVP 页面建议分为五个区块：

### 11.1 Overview

展示：

- 当前服务状态
- 监听 URL
- 容器访问 URL
- 当前协议白名单
- 当前 host 白名单
- token 文件路径
- state dir 路径
- 最近一次启动时间

### 11.2 Setup

展示并可复制：

- `curl .../container/install.sh | sh`
- 全局配置 Git helper 的命令
- `docker-compose` 片段
- `devcontainer` 片段
- token 文件挂载说明

要求：

- Setup 页面必须根据当前 `publicUrl` 和当前 state dir 动态生成示例
- 不要把 token 明文直接显示在页面上
- 允许显示 token 文件路径

### 11.3 Requests

展示最近请求表格：

- time
- action
- protocol
- host
- path
- outcome
- duration

### 11.4 Logs

展示 `server.log` 的最近内容。

MVP 直接轮询 `GET /api/admin/logs` 即可，不先做实时流。

### 11.5 Settings

允许：

- 修改 host / port / publicUrl
- 修改协议白名单
- 修改 host 白名单
- 保存配置
- 重启服务
- 轮换 token

配置保存后的行为建议：

- 先写入 `config.json`
- 再触发服务重启
- 页面显示“正在重启 / 已重启”的明确反馈

## 12. 容器 helper 设计

### 12.1 基本原则

容器 helper 必须改成不依赖 `node` / `bun` 的实现。

目标是：

- 有 `sh`
- 有 `curl`
- 就能工作

### 12.2 helper 文件

保留文件名：

- `git-credential-hostproxy`

建议行为：

- 读取 Git 传入的 stdin
- 根据命令参数识别 `get` / `store` / `erase`
- 映射到 `/fill` / `/approve` / `/reject`
- 通过 `curl` 发到宿主机服务

环境变量：

- `GIT_CRED_PROXY_URL`：默认 `http://host.docker.internal:18765`
- `GIT_CRED_PROXY_TOKEN`：可选，直接传 token
- `GIT_CRED_PROXY_TOKEN_FILE`：默认 `/run/host-git-cred-proxy/token`

优先级：

1. `GIT_CRED_PROXY_TOKEN`
2. `GIT_CRED_PROXY_TOKEN_FILE`

### 12.3 安装脚本

新增：

- `container/install.sh`

功能：

- 把 `git-credential-hostproxy` 安装到 `/usr/local/bin`
- 如有需要，同时安装 `configure-git.sh`
- 尽量不做复杂依赖检查，只校验 `sh` / `curl` / 写权限

### 12.4 Git 配置方式

MVP 推荐继续保留 `configure-git.sh`，但它不再依赖仓库路径。

预期行为：

- 优先使用 PATH 中的 `git-credential-hostproxy`
- 支持 `--global`
- 支持 `--local`
- 支持 `--repo PATH`

换句话说，配置脚本可以保留，但必须从“仓库路径绑定模式”改成“已安装命令模式”。

## 13. Web 服务向容器分发 helper

为实现“直接用”，宿主机服务必须暴露 helper 下载入口。

这是本轮设计里很关键的一点，因为它能把容器接入改成：

```bash
curl -fsSL http://host.docker.internal:18765/container/install.sh | sh
```

而不再要求：

- 挂载整个源码仓库
- 预装 `node`
- 预装 `bun`
- 容器必须能访问 GitHub

要求：

- `install.sh` 和 `git-credential-hostproxy` 作为静态内容由宿主机服务返回
- 返回内容允许根据当前端口和 URL 进行简单模板替换
- 这些下载路由不需要 admin 权限，也不需要 proxy token

## 14. 发布与分发策略

### 14.1 主发布渠道

主发布渠道确定为：

- GitHub Releases
- Homebrew tap

MVP 不把 `npm` 包作为主发布渠道。

### 14.2 二进制产物

发布以下两个目标：

- `darwin-arm64`
- `darwin-x64`

建议产物名：

- `host-git-cred-proxy-darwin-arm64.tar.gz`
- `host-git-cred-proxy-darwin-x64.tar.gz`

每个 tarball 中至少包含：

- `bin/host-git-cred-proxy`
- `share/host-git-cred-proxy/ui/*`
- `share/host-git-cred-proxy/container/install.sh`
- `share/host-git-cred-proxy/container/configure-git.sh`
- `share/host-git-cred-proxy/container/git-credential-hostproxy`

这里明确采用“二进制 + 静态资源目录”的打包方式，而不是强行追求所有内容都塞进单一可执行文件。

这样做的理由：

- 避免 Bun 编译时静态资源嵌入带来的额外不确定性
- 方便 Homebrew 安装 `share/` 目录资源
- 方便本地开发与打包产物共用同一套 UI 资源读取逻辑

### 14.3 Homebrew

Homebrew 作为默认安装入口。

期望用户体验：

```bash
brew install <tap>/host-git-cred-proxy
host-git-cred-proxy start
```

Formula 负责：

- 安装二进制到 `bin/`
- 安装 UI 和 helper 资源到 `share/host-git-cred-proxy/`

### 14.4 npm 的定位

可以保留 `package.json` 作为源码开发入口，但 MVP 不做“主打 npm 安装”。

如果后续要发 npm，定位也应是：

- 源码开发入口
- CI / 本地开发辅助
- 非主支持平台的备用渠道

而不是主要用户安装方式。

## 15. 建议的仓库结构

建议重构为如下结构：

```text
host-git-cred-proxy/
├── host/
│   ├── src/
│   │   ├── cli.ts
│   │   ├── server.ts
│   │   ├── routes/
│   │   │   ├── admin.ts
│   │   │   ├── proxy.ts
│   │   │   └── container.ts
│   │   ├── services/
│   │   │   ├── config.ts
│   │   │   ├── git-credential.ts
│   │   │   ├── process-manager.ts
│   │   │   ├── request-log.ts
│   │   │   ├── state-dir.ts
│   │   │   ├── token.ts
│   │   │   └── ui-assets.ts
│   │   └── utils/
│   │       ├── loopback.ts
│   │       └── sanitize.ts
│   ├── ui/
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── api.ts
│   │       ├── pages/
│   │       └── components/
│   ├── start.sh
│   ├── stop.sh
│   └── status.sh
├── container/
│   ├── install.sh
│   ├── configure-git.sh
│   └── git-credential-hostproxy
├── examples/
├── package.json
└── IMPLEMENTATION_PLAN.md
```

说明：

- `host/server.mjs` 和 `container/helper.mjs` 的职责会被新的 TypeScript 实现取代
- 老脚本先留作兼容入口，避免一次性删除造成迁移风险

## 16. 实施阶段

### 阶段 1：宿主机服务基础迁移

目标：先把代理核心迁到 Bun/Elysia，并建立新的状态目录与 CLI。

任务：

- 建立 Bun + TypeScript 运行结构
- 实现 `cli.ts` 的 `start/serve/stop/status/open`
- 实现状态目录解析与 `config.json` 读写
- 把当前代理逻辑迁到新的 `/fill`、`/approve`、`/reject`
- 增加请求脱敏日志
- 让旧 `host/start.sh` / `stop.sh` / `status.sh` 代理到新 CLI

完成标准：

- 不启动 UI 也能通过 CLI 运行代理
- 容器仍可按旧协议访问 `/fill` 等接口
- 状态不再写入仓库目录

### 阶段 2：Web 面板

目标：补齐本地可视化管理能力。

任务：

- 建立 `React + Vite` 前端工程
- 实现 Overview / Setup / Requests / Logs / Settings 页面
- 实现 `/api/admin/*` 路由
- 实现 loopback 校验、Origin 校验、`X-Admin-Nonce`
- 完成静态资源托管

完成标准：

- 本地浏览器可以打开面板
- 非 loopback 客户端访问 UI / admin API 会被拒绝
- 可以在页面里修改配置并重启服务

### 阶段 3：容器 helper 去运行时依赖

目标：让容器接入不再依赖源码仓库、Node、Bun。

任务：

- 用 shell 重写 `git-credential-hostproxy`
- 新增 `container/install.sh`
- 重写 `container/configure-git.sh` 为已安装命令模式
- 在宿主机服务内暴露 `/container/*` 下载路由
- 更新 `examples/` 为 token 文件挂载模式

完成标准：

- 容器内只有 `sh + curl + git` 也能接入
- 不挂载源码仓库也能完成配置

### 阶段 4：打包与发布

目标：形成真正可安装的产品分发链路。

任务：

- 构建 UI 产物
- 编译 macOS `arm64` / `x64` 二进制
- 组装 tarball
- 编写 Homebrew formula / tap
- 做最小 smoke test

完成标准：

- 从 GitHub Release 下载 tarball 后可直接运行
- `brew install` 后可直接 `host-git-cred-proxy start`

## 17. 验收标准

以下条件全部满足，才算这一轮完成：

- 用户不需要先 `git clone` 本仓库，也能在宿主机安装和启动服务
- 用户可以在本地浏览器打开 Web 面板
- UI、管理 API、代理 API 共用一个端口
- 容器 helper 不再依赖 `node` / `bun`
- 容器不挂载源码仓库，也能安装 helper 并使用代理
- 代理仍然支持协议白名单和 host 白名单
- token 和请求日志不泄露敏感凭证内容
- 提供 `darwin-arm64` 与 `darwin-x64` 二进制发布产物
- 提供 Homebrew 安装路径

## 18. 测试建议

实现阶段至少覆盖以下测试：

- 配置读写测试
- loopback 判断测试
- admin nonce / origin 校验测试
- 代理请求 body 解析与脱敏测试
- `git credential fill` 缺失凭证时的兼容行为测试
- shell helper 的 basic smoke test
- 编译后二进制的启动与 `/healthz` smoke test

## 19. 额外约束

实现时请遵守以下约束：

- 不要把 proxy token 明文显示在 UI 上
- 不要把凭证请求体完整落盘
- 不要让管理 API 复用 proxy token
- 不要让 UI 依赖额外 dev server 才能运行产品版
- 不要把容器 helper 再次实现成 Node/Bun 脚本

## 20. 一句话结论

这一轮不是“小修小补”，而是一次明确的产品化改造：

- 宿主机：`Bun + Elysia + React`，单端口，本地面板
- 容器：`sh + curl` helper，零运行时依赖
- 发布：`macOS 二进制 + GitHub Releases + Homebrew`

后续 agent 按这个文档分阶段推进即可，不需要再回到“是否继续绑定源码仓库路径”这类问题上反复摇摆。
