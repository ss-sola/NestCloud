# NestCloud

NestCloud 在同一个 Nest 应用中提供配置发布、配置拉取、服务注册、心跳和发现。管理控制台随服务一起提供。

## 本地运行

使用 Node.js 24.16 或更高版本、pnpm 和 PostgreSQL。将 NestCloud-Sdk 克隆至本仓库的同级目录，SDK 的包名为 `@nest-cloud/sdk`。

```powershell
pnpm --dir ../NestCloud-Sdk install
pnpm --dir ../NestCloud-Sdk build
pnpm install
Copy-Item .env.example .env
```

在 PostgreSQL 中建立数据库，在 `.env` 中填写对应的连接参数和部署专用的 `SessionSecret`。首次安装时，用拥有建表权限的角色在该数据库执行 [sql/init.sql](sql/init.sql)。配置文件由控制台或 API 创建、发布。设置 `RegistryRedisUrl` 可将注册信息存放到 Redis，留空使用进程内存。

启用控制面鉴权时，在 NestCloud 和接入服务的 `.env` 或进程环境中设置相同的 `ControlPlaneToken`。控制台每个浏览器会话输入一次 Token，刷新页面可继续使用当前会话。[部署和接入说明](docs/project/部署与可观测性.md#控制面鉴权)

本仓库的 `sql/sdk/` 维护 SDK 所需表的建表脚本。启用写请求幂等前，在每个接收写请求的业务数据库执行对应脚本。可选 [PostgreSQL](sql/sdk/add-rpc-idempotency-record.sql) 或 [MySQL InnoDB](sql/sdk/add-rpc-idempotency-record.mysql.sql)。多个服务共用同一幂等表时只需执行一次，已有库可重复执行。

```powershell
pnpm start:dev
```

示例配置使用端口 3001 和 API 前缀 `api`。控制台地址为 [http://localhost:3001/public/](http://localhost:3001/public/)，客户端将 `RegistryUrl` 设为 `["http://localhost:3001"]`。部署时从仓库根目录执行以下命令，并将 `public/` 与 `dist/` 同级保留。

控制台的 TypeScript 源码位于 `console/`。`pnpm start:dev` 同时监听后端和控制台改动，修改控制台后刷新浏览器即可。`pnpm build:console` 编译浏览器模块到 `public/js/`，并将 pnpm 安装的 Bootstrap 和 Monaco 复制到 `public/vendor/`。完整构建也会执行这一步。部署时请复制构建后的整个 `public/` 目录。

```powershell
pnpm build
pnpm start:prod
```

## Docker 打包

在本仓库根目录执行 `pnpm run docker:build`，即可打包注册中心及其管理控制台。镜像名称为 `solacloud/nestcloud:local`。[Docker 打包与启动](docs/project/部署与可观测性.md#docker-镜像)

## 验证

安装开发依赖后，Husky 的 `pre-commit` 钩子会格式化已暂存文件，并对已暂存源码运行 oxlint。

```powershell
pnpm lint
pnpm test
pnpm tsgo
```

开发和修复分支通过 PR 合入 `dev/master`。发布时，从本仓库的 `dev/master` 向 `master` 发起 PR，并使用 **Squash and merge** 将本次发布压缩为一条提交。两个目标分支均要求 GitHub Actions 通过 lint、测试、类型检查和构建，发布 PR 还会检查来源分支。

草稿编辑、并发发布和版本拉取见[配置文件接口](docs/config-center/接口清单.md)。新注册的实例可提供完整的 HTTP(S) 地址或主机和端口，地址解析与兼容约定见[注册与发现接口](docs/registry-center/注册与发现接口.md)。

配置发布协议、服务发现流程与存储策略见[模块文档](docs/index.md)和[客户端接入文档](docs/project/配置中心与注册中心.md)。
