# Homix Marketing Listing V3

Homix Realty 的房源营销邮件工作台。系统将联系人、房源、受众、Campaign、Resend 投递与合规事件放在一个可审计流程中；生产数据库为 PostgreSQL，Web、Worker 和 Migration 使用同一不可变 Docker 镜像、三个独立运行角色。

## 能力

- React 工作台：首页 MLS/地址搜索、次级 Property Library、单页邮件编辑器、Campaign 生命周期、Contacts/Lists/Suppressed、Reports 与分层 Settings/Operations。
- Express `/api/v2`：Entra Easy Auth 身份映射、ADMIN/MARKETER/VIEWER RBAC、CSRF、速率限制和 mutation audit。
- OneKey/BBO：按 MLS 号或地址搜索本地索引，通过 BBO 的合规 listing API 导入/刷新房源、复制媒体，并显式预览/导入最近 12–24 个月同邮编及相邻邮编成交经纪人受众；不存在 Homix/挂牌办公室所有权门禁。
- AI 辅助：支持 OpenAI 与 Azure OpenAI Responses API、结构化输出、只使用 allowlist 房源事实，先保存 proposal，再由用户逐字段 Apply；`fake` 会明确标为测试文案且不能在生产 UI 中生成。
- Prisma/PostgreSQL：冻结的 content/recipient snapshot、全局 suppression、发送批次/尝试、Webhook inbox、配额预留和 `SKIP LOCKED` durable jobs。
- Resend：最多 100 封的 batch、同批次稳定 idempotency key、temporary retry、uncertain manual review、signed raw-body Webhook、visible/RFC 8058 unsubscribe。
- 资产：JPG/PNG/WebP 经过 Sharp 去 EXIF 并生成 1200/600 JPEG；PDF 保留；生产写入 Azure Blob，邮件只引用永久公开 URL。
- Azure：Container Apps Web/Worker/Migration Job、PostgreSQL 16、Blob、Key Vault、Managed Identity、VNet/private endpoints、ACR、Application Insights 和可选告警。

## 本地快速启动

要求 Node.js 22、Docker 与 Docker Compose。

```bash
npm ci
cp .env.example .env
# 将 SESSION_SECRET 与 UNSUBSCRIBE_SIGNING_SECRET 改为两个不同的本地随机值
chmod 600 .env
npm run db:up
npm run prisma:migrate:deploy
npm run db:seed
npm run dev
```

打开 `http://localhost:5173`，使用 `.env` 中 `LOCAL_ADMIN_EMAIL` 登录。另一个终端启动 Worker：

```bash
npm run dev:worker
```

默认 `EMAIL_DELIVERY_MODE=disabled`，不会调用外部邮件发送。测试使用 `FakeEmailProvider`，也不会调用 Resend。Compose 默认把 PostgreSQL 映射到 `localhost:5434`，可用 `POSTGRES_PORT` 覆盖。

OneKey 与 AI 同样默认禁用，不需要外部凭据即可启动。开发验收可设置 `ONEKEY_PROVIDER=fake` 和 `AI_PROVIDER=fake`。生产使用 `ONEKEY_PROVIDER=bbo`，由 BBO 提供 OneKey listing/媒体/收件人数据；BBO key 必须仅授予 `marketing:read` 与读取 listing/events 所需的最小 scope。若 BBO 的媒体使用独立主机，必须用 `ONEKEY_MEDIA_ALLOWED_ORIGINS` 明确列出完整 origin（例如 `https://onekeymls.kevv.ai`）；不接受路径或通配域名。

## Quick Start: Send a Listing Email

1. 在 Home 输入 MLS 号或地址并选择房源；在 **Email signature & replies** 确认 Homix Agent。只有 OneKey 挂牌姓名与本地 Agent 完全一致时系统才会预选，不会回退到第一个 Agent。缺少 Agent 时先在 Settings 添加姓名、真实邮箱、电话和执照信息。系统随后导入或复用房源，并创建/复用最近 24 小时的草稿。
2. 默认选择 **Nearby active agents**；也可直接选择 Saved contact list 或安全 Custom segment。附近经纪人默认使用同邮编加最近 3 个邮编、过去 12 个月成交，并排除抑制、近期已发和同房源已联系地址。
3. AI 生产配置可用时会自动写一次初稿并提供三个主题方案与改写风格；否则保留安全的人工起始文案。Subject、preview text、正文、CTA 都可直接编辑并自动保存。
4. 在右侧 Desktop/Mobile 预览确认完整房源和 Listing Agent 落款，然后点击 **Send test to me** 测试当前版本。
5. 测试成功后点击 **Review & send**，选择立即或定时发送并确认。服务端原子验证版本并创建不可变内容/收件人快照。
6. 在 Campaigns 查看 In progress、Preparing、Scheduled、Sending、Paused 或 Sent，并在 Reports 查看汇总。已有房源的落款人可在 Property Library 的 **Signature & replies** 改绑；所有 DRAFT Campaign 会同步并要求重新测试，已冻结或已发送快照保持不变。旧 `/listings`、`/audiences`、`/analytics` 链接会重定向到新页面。

普通 Marketer 页面不需要理解 provider、model、audience filter、snapshot 或 worker；这些仍保留在服务端和管理员 Operations 中。旧 V2 API 继续兼容，自动保存使用 `If-Match`，测试和发布都要求当前版本。

## 运行角色

```bash
APP_ROLE=web npm start
APP_ROLE=worker npm start
APP_ROLE=migrate npm start
```

- `web` 仅提供 HTTP API/SPA。
- `worker` 仅轮询 PostgreSQL jobs、发送批次和处理 Webhook inbox。
- `migrate` 依次运行 `prisma migrate deploy` 和幂等种子，然后退出。

三者使用同一个 `Dockerfile`。

## 常用命令

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:api
npm run test:integration
npm run test:e2e
npm run test:coverage
npm run build
npm run docker:build
npm run infra:lint
npm run openapi:lint
npm audit --audit-level=high
npm run licenses:check
```

Integration 与 E2E 脚本分别只创建/删除 `homix_marketing_test` 和 `homix_marketing_e2e`；它们不会删除开发数据库。脚本会启动本地 PostgreSQL，应用迁移和 seed；Playwright 随后自动启动 Web 与 Worker，Web 进程直接提供已构建的 SPA 静态资源。

Coverage 分为快速 unit/domain 门禁与 PostgreSQL service 门禁；Campaign、Delivery、Import、Webhook 四个关键 service 均逐文件强制 statements/branches/functions/lines 不低于 80%。

## 安全默认值

- 新环境、seed 后和数据库恢复后均为全局暂停；管理员完成 reconciliation 并记录原因后才能恢复。
- `disabled` 禁止外发；`sandbox` 只允许 `EMAIL_TEST_ALLOWLIST`；`live` 在每次 snapshot/send 时重新验证 sender、地址、URL、测试发送和系统 readiness。
- 可见 unsubscribe 与 RFC 8058 one-click 使用独立签名 secret，并支持有明确到期时间的 previous secret 重叠轮换。
- Webhook 无法匹配 recipient 时按 30 秒、2 分、10 分、30 分、2 小时重试，之后进入可见 dead letter；uncertain batch 只能通过审计化 manual-review 操作处理。
- 生产拒绝 local auth、`DEV_BYPASS_AUTH`、非 TLS PostgreSQL 和 local storage；live delivery 另行拒绝占位公司地址与 localhost `BASE_URL`。
- Key Vault reference 承载 secret；代码、Bicep 参数示例、前端 bundle 和日志不包含真实值。
- 公共路由只包括 health、Resend Webhook、unsubscribe 与本地资产；`/api/v2/*` 始终在应用层再做身份和角色校验。

完整配置见 `.env.example`。

## 文档

- `docs/AZURE_DEPLOYMENT.md`
- `docs/OPERATIONS_RUNBOOK.md`
- `docs/DATA_MODEL.md`
- `docs/API.md` 与 `openapi.yaml`
- `docs/SECURITY.md`
- `docs/MIGRATION.md`

## Azure 与 CI/CD

首次部署由 `scripts/provision-azure.sh` 执行 subscription bootstrap、ACR build、资源部署和 migration；后续 release 由 `scripts/deploy-release.sh` 严格按 Migration → Web readiness → Worker 顺序推进。GitHub Actions 使用 Azure OIDC 和受保护的 `development`/`production` Environments，不保存长期 Azure client secret。

生产首次部署仍保持 `EMAIL_DELIVERY_MODE=disabled`。真实 Entra/Resend/DNS/公司地址完成前不得切换 live。仓库包含 `azure.yaml` 供 azd 识别，但 canonical deployment 是 Bicep + Bash + GitHub Actions。

## License

MIT
