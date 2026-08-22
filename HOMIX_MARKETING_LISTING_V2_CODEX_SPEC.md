# Homix Marketing Listing V2

## Codex 一次性实施规格（基于现有 Email Service，部署到 Microsoft Azure）

- **文档用途**：把本文件完整交给 Codex，并让 Codex在当前仓库内完成实现。
- **目标仓库**：现有 `emailService` 仓库，不另起一个空白项目。
- **目标版本**：`2.0.0`
- **默认产品名**：`Homix Marketing`
- **默认后台域名**：`marketing.homixny.com`
- **默认营销发件域名**：`listings.homixny.com`
- **默认发件地址**：`Homix Realty <listings@listings.homixny.com>`
- **默认时区**：`America/New_York`
- **默认 Azure 区域**：`eastus2`
- **文档状态**：实现规范；不是讨论稿。

---

# 0. 给 Codex 的总指令

你正在修改一个已有的 Node.js / TypeScript / Express / SQLite / Resend 邮件项目。不要只输出计划、脚手架、伪代码或零散补丁。请在**当前仓库**中持续工作，直到本规范的应用代码、数据库迁移、测试、Docker 镜像、Azure IaC、CI/CD 和文档全部完成，并且本地可执行的检查全部通过。

## 0.1 执行规则

1. **保留 Git 历史，不重新初始化仓库。**如果工作区允许，创建分支 `feature/homix-marketing-v2`；若无法创建分支，继续在当前分支完成。
2. **不要推倒邮件基础设施后自行实现 SMTP。**继续使用 Resend 作为邮件投递服务商，但重构发送、重试、状态追踪与 Webhook 处理。
3. **不要使用多个子域轮换发件来规避 spam reputation。**系统必须采用稳定 sender profile；默认使用 `listings@listings.homixny.com`，具体经纪人邮箱作为 `Reply-To`。
4. **不要在生产环境继续使用 SQLite。**改用 PostgreSQL 和 Prisma。
5. **不要让 Web 和 Worker 共用同一进程。**同一 Docker image 分别以 `APP_ROLE=web` 与 `APP_ROLE=worker` 部署为两个 Azure Container Apps。
6. **不要把发送对象在每个 chunk 时重新查询。**Campaign 进入发送流程时必须冻结 `campaign_recipients` 快照。
7. **不要仅凭存在一条失败日志就永久跳过收件人。**必须实现 recipient-level retry、错误分类、最大尝试次数与可人工复核状态。
8. **不要在代码、Git、日志、前端 bundle 或 Bicep 参数文件中写入真实 secret。**所有 secret 使用 `.env`（本地）或 Azure Key Vault reference（生产）。
9. **不要等待用户提供 Azure、Resend、DNS 或 Entra secret 才写代码。**使用明确占位符和 `.env.example`；完成所有可实现内容。只有真实外部凭据、DNS 记录和公司实体地址属于部署前人工输入。
10. **不要留下功能性 TODO。**只允许对真实外部值使用 `REQUIRED_VALUE` 一类占位符。
11. **严格 TypeScript。**业务代码禁止无边界的 `any`；第三方 Webhook payload 可在入口处使用 `unknown`，随后以 Zod 解析。
12. **所有数据库写操作要考虑事务、幂等性、并发和失败恢复。**
13. **持续运行并修复**：format、lint、typecheck、unit tests、integration tests、client build、server build、Docker build。不要在首次失败后停止。
14. 无法真正登录 Azure 时，不要宣称已经部署成功；但必须完成并验证 IaC 语法、部署脚本、GitHub Actions 和运行手册。
15. 完成后更新 `README.md`，并输出：主要改动、测试结果、部署命令、仍需用户填写的外部值。

## 0.2 最终完成标准概览

最终系统必须让 Homix 员工完成以下完整闭环：

```text
Create / Import Contacts
        ↓
Create Listing + Upload Marketing Assets
        ↓
Build / Save Audience
        ↓
Create Listing Campaign
        ↓
Preview + Test Send
        ↓
Schedule or Send Now
        ↓
Freeze Recipient + Content Snapshot
        ↓
Enforce Suppression + Daily Quota + Send Window
        ↓
Resend Batch API with Idempotency
        ↓
Webhook: accepted / delivered / bounced / complained / opened / clicked
        ↓
Campaign Analytics + Per-recipient Audit Trail
```

---

# 1. 现有仓库基线与升级策略

## 1.1 已确认的现有技术栈

当前仓库主要包含：

- Node.js + TypeScript
- Express 5
- SQLite / `better-sqlite3`
- Resend SDK
- Vanilla HTML / CSS / JavaScript 管理后台
- Resend batch send 与单封 fallback
- subscribers、tags、campaigns、send logs、jobs
- unsubscribe / List-Unsubscribe / one-click header
- Resend Webhook signature verification 与 delivery event tracking
- CSV import/export
- Dockerfile、GitHub Actions、Railway-oriented deployment

## 1.2 升级原则

这次不是“在旧页面上换文案”，也不是“另写一套完全无关的项目”。采用以下策略：

### 保留并重构其概念

- Resend provider integration
- unsubscribe 与 compliance header
- plain-text 邮件
- Webhook signature verification
- CSV 联系人导入的基本能力
- preview、test send、duplicate campaign 的产品概念
- Docker 与 CI 基础
- email sanitization 的安全意识

### 彻底替换

- SQLite connection 与手写 migration
- `subscribers` 过度简单的数据模型
- 全局 `.env` sender/reply-to
- 当前 `jobs` 与内嵌 worker 实现
- 动态分批查询受众的发送方式
- 以 `send_logs` 是否存在来判断是否重发的逻辑
- Vanilla single-file 管理后台
- `recruitmentEmail.ts` 招聘导向模板
- CID embedded asset 作为批量发送主路径
- 共享 `API_SECRET` 作为生产多人登录方式

### 新增

- Listings
- Agents
- Contacts with structured real-estate interests
- Markets / Property Interests / Tags
- Saved Audiences
- Sender Profiles
- Campaign recipient snapshot
- Independent global suppression
- Real daily quota reservation
- Durable recipient retry state machine
- Resend batch idempotency
- Webhook inbox + deduplication
- React admin application
- Azure PostgreSQL / Blob / Key Vault / Entra ID / Container Apps
- Bicep、GitHub Actions OIDC、migration job、operations runbook

## 1.3 必须修复的旧系统缺陷

1. `DAILY_SEND_COUNT` 不能只用于计算间隔；必须真正阻止超过 sender 当日额度。
2. Campaign send 时必须冻结 audience，之后联系人标签变化不得影响已发送 Campaign。
3. Transient API failure 不得因为已有失败日志而永久跳过收件人。
4. Suppression 必须与 contact 独立；删除再导入 contact 不得重新激活退订或投诉地址。
5. Webhook 必须按 `svix-id` 去重，且能处理至少一次投递和乱序事件。
6. 每个 batch retry 必须复用同一个 Resend idempotency key。
7. From/Reply-To 必须按 sender profile 与 campaign 配置，不得全局写死。
8. Web 与 Worker 必须可独立发布、重启、扩缩容。

## 1.4 现有文件到 V2 的迁移映射

Codex先阅读这些实际文件，再按下表迁移；不要把旧实现原封不动复制进新模块。

| 当前文件 | V2 处理 | 目标位置/说明 |
|---|---|---|
| `src/services/emailSender.ts` | 保留provider调用经验，重写 | `src/email/providers/ResendEmailProvider.ts`；增加batch prevalidation、idempotency、结果映射 |
| `src/webhooks/resendWebhook.ts` | 保留signature verification概念，重写持久化 | `src/modules/webhooks/*`；raw body、inbox、dedupe、worker processing |
| `src/routes/webhook.ts` | 替换 | public route固定为 `/api/public/webhooks/resend` |
| `src/routes/unsubscribe.ts` | 保留合规意图，重写 | visible confirm + RFC 8058 one-click + global suppression |
| `src/services/jobService.ts` / `scheduler.ts` | 替换 | PostgreSQL durable jobs、SKIP LOCKED、lease/retry/heartbeat |
| `src/services/campaignService.ts` | 重写业务模型 | listing campaign、snapshot、state machine |
| `src/services/subscriberService.ts` | 替换 | contacts/imports/suppressions/audiences modules |
| `src/services/tagService.ts` | 迁移概念 | tags + markets + property interests reference data |
| `src/services/emailAssetService.ts` | 重写storage层 | local/Azure Blob adapters、image processing、public immutable URLs |
| `src/services/runtimeStateService.ts` | 替换 | DB system settings、readiness、global pause与audit |
| `src/templates/recruitmentEmail.ts` | 删除 | React Email listing templates |
| `src/db/connection.ts` / `schema.ts` | 删除production runtime | Prisma/PostgreSQL；仅legacy migration script可读SQLite |
| `src/utils/compliance.ts` / `emailHtml.ts` | 提取可验证规则 | `src/email/compliance.ts`、template sanitizer/render tests |
| `src/utils/csv.ts` | 重写为stream import | field mapping、dedupe、error report、formula injection防护 |
| `src/utils/warmup.ts` | 保留算法意图，重写 | sender profile warm-up + transactional quota |
| `src/utils/auth.ts` | 替换 | Entra Easy Auth principal + local dev adapter + RBAC |
| `public/*` | 删除旧single-page UI | React/Vite client |
| `data/*.db*` | 不进入生产或镜像 | legacy dry-run/apply migration输入；备份后归档 |
| `dist/*` | 不作为source | clean build重新生成，不提交 |
| `.github/workflows/ci.yml` | 重写 | Linux clean install、Postgres tests、Docker/Bicep checks |
| `Dockerfile` | 重写 | Node 22 multi-stage、non-root、same image three roles |

若现有 `.env` 含真实Resend或其他凭据：不得复制到文档、log或新配置；从Git跟踪中移除，并在认为可能暴露时安排轮换。只提交 `.env.example`。

---

# 2. 产品范围

## 2.1 用户角色

### `ADMIN`

- 所有读写权限
- 管理用户、角色、agents、sender profiles、reference data
- 可以解除 manual suppression，但必须输入原因并写 audit log
- 可以启用 live sending
- 可以查看敏感运行状态，但不能看到 secret 明文

### `MARKETER`

- 管理 contacts、listings、audiences、campaigns
- preview、test send、schedule、send、pause、resume、cancel
- 不能管理用户权限
- 不能解除 complaint / hard bounce / unsubscribe suppression
- 不能修改生产 sender verification 状态

### `VIEWER`

- 只读查看 listings、campaigns、analytics、contacts
- 不得导出全部联系人，除非额外由 Admin 开启

## 2.2 MVP 必须包含

1. Microsoft Entra ID 登录和本地开发登录模式
2. Contacts CRUD、CSV import、dedupe、tags、markets、property interests
3. Suppression 管理和不可意外复活规则
4. Agents CRUD
5. Listings CRUD 与图片/PDF资产管理
6. Saved Audience builder、estimate、sample
7. Campaign wizard
8. 两个响应式 listing email templates
9. Preview、mobile preview、test send
10. Schedule、send now、pause、resume、cancel
11. Campaign recipient snapshot
12. PostgreSQL durable queue / worker
13. True daily quota、send window、batch pacing
14. Resend idempotent batch sending
15. Resend Webhook inbox、dedupe、event processing
16. Unsubscribe visible flow 与 RFC 8058 one-click flow
17. Dashboard、campaign analytics、recipient drill-down、CSV export
18. Audit log
19. Azure deployment infrastructure and runbook
20. Legacy SQLite import utility

## 2.3 明确不在本次范围

- 自建 SMTP 或 MTA
- 多域名随机轮换、发件地址随机化
- 抓取、购买或清洗来源不明的陌生名单
- SMS、WhatsApp、微信推送
- 完整地产 CRM、deal pipeline、commission accounting
- MLS/RLS 自动同步
- 公共 listing 网站或 SEO landing page
- 多租户 SaaS
- A/B testing、AI 自动写文案
- Dedicated IP warm-up automation
- Azure Service Bus；本版本使用 PostgreSQL durable jobs

---

# 3. 目标系统架构

## 3.1 逻辑架构

```mermaid
flowchart TD
    Browser[Homix Employee Browser] -->|HTTPS + Entra ID| Web[Azure Container App: Web]
    Web --> API[Express REST API]
    API --> PG[(Azure PostgreSQL)]
    API --> Blob[Azure Blob: Public Marketing Assets]
    API --> KV[Azure Key Vault via references]

    Worker[Azure Container App: Worker] --> PG
    Worker --> Blob
    Worker --> Resend[Resend API]

    Resend -->|Signed webhook| Web
    Web -->|Durable webhook inbox| PG
    Worker -->|Process webhook events| PG

    Web --> AppInsights[Application Insights / Azure Monitor]
    Worker --> AppInsights
```

## 3.2 Azure 运行单元

使用**同一个 Docker image**，部署三种 execution role：

| Role | Azure Resource | Ingress | Replicas | Command / Env |
|---|---|---:|---:|---|
| Web | Container App `homix-marketing-web` | External HTTPS | min 1, max 3 | `APP_ROLE=web` |
| Worker | Container App `homix-marketing-worker` | None | min 1, max 1 initially | `APP_ROLE=worker` |
| Migration | Container Apps Job `homix-marketing-migrate` | None | manual execution per release | `APP_ROLE=migrate` |

Worker 初期保持 1 replica。即使未来扩到多个 worker，数据库 claim 逻辑也必须通过 `FOR UPDATE SKIP LOCKED` 保证并发安全。

## 3.3 请求与进程入口

统一入口 `src/main.ts`：

```ts
switch (config.appRole) {
  case "web":
    await startWebServer();
    break;
  case "worker":
    await startWorker();
    break;
  case "migrate":
    await runMigrations();
    break;
  default:
    throw new Error("Unsupported APP_ROLE");
}
```

Web 进程不得启动发送 worker；Worker 不得开启外部 HTTP server，可仅开启内部 graceful-shutdown lifecycle。

---

# 4. 技术栈与工程约束

## 4.1 Runtime / Backend

- Node.js 22 LTS compatible runtime
- TypeScript strict mode
- Express 5
- PostgreSQL
- Prisma ORM + Prisma Migrate
- Zod request/config validation
- Resend SDK；若 SDK 的某项 batch idempotency 参数不兼容，允许使用官方 REST endpoint，但必须封装在 provider adapter 中
- `@azure/identity`
- `@azure/storage-blob`
- `sharp`
- `@react-email/components` + `@react-email/render`，用于 email template
- `sanitize-html` 或等价严格 allowlist sanitizer
- Pino / pino-http structured logging
- Azure Monitor OpenTelemetry distribution

## 4.2 Frontend

- React + TypeScript
- Vite
- React Router
- TanStack Query
- React Hook Form + Zod
- TipTap，仅允许受控的 intro/body rich-text 子集
- Recharts 或等价轻量图表库
- Tailwind CSS 或一致的 component primitives
- Lucide icons 或等价开源图标

不要引入需要商业许可证的 UI 组件。

## 4.3 Testing

- Vitest
- Supertest
- PostgreSQL integration tests（Testcontainers 或 CI service container）
- Playwright end-to-end tests
- Docker build smoke test
- Bicep lint/build

## 4.4 Coding rules

- 所有金额使用 `Decimal`，不得使用 JS float 做财务格式化之外的计算。
- 所有时间存 UTC，界面按 `America/New_York` 显示。
- Email normalization：`trim().toLowerCase()`；不要擅自删除 Gmail `+tag` 或点号。
- Pagination 使用 cursor 或 page/limit，默认 25、最大 100。
- REST error envelope：

```json
{
  "error": {
    "code": "CAMPAIGN_INVALID_STATE",
    "message": "Campaign must be READY before scheduling.",
    "details": {},
    "requestId": "..."
  }
}
```

- 所有 mutation 写 `audit_logs`。
- 日志中默认只记录 entity ID，不记录完整 recipient list；必要时邮箱要 mask。
- 禁止将 raw Resend API key、Webhook secret、DB password 输出到日志。
- Export CSV 要防止 spreadsheet formula injection：以 `=`, `+`, `-`, `@` 开头的值需安全转义。

---

# 5. 目标目录结构

将仓库整理为以下结构。允许为编译需要小幅调整，但模块边界必须保留。

```text
.
├── client/
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── app/
│       ├── components/
│       ├── features/
│       │   ├── auth/
│       │   ├── dashboard/
│       │   ├── contacts/
│       │   ├── listings/
│       │   ├── audiences/
│       │   ├── campaigns/
│       │   ├── analytics/
│       │   └── settings/
│       ├── lib/
│       ├── pages/
│       └── main.tsx
├── src/
│   ├── main.ts
│   ├── config/
│   │   ├── env.ts
│   │   └── index.ts
│   ├── db/
│   │   ├── prisma.ts
│   │   ├── transactions.ts
│   │   └── rawQueries.ts
│   ├── web/
│   │   ├── app.ts
│   │   ├── server.ts
│   │   ├── middleware/
│   │   └── routes/
│   ├── worker/
│   │   ├── worker.ts
│   │   ├── jobRunner.ts
│   │   └── handlers/
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── agents/
│   │   ├── contacts/
│   │   ├── imports/
│   │   ├── referenceData/
│   │   ├── suppressions/
│   │   ├── listings/
│   │   ├── assets/
│   │   ├── audiences/
│   │   ├── senderProfiles/
│   │   ├── campaigns/
│   │   ├── delivery/
│   │   ├── webhooks/
│   │   ├── analytics/
│   │   └── audit/
│   ├── email/
│   │   ├── providers/
│   │   │   ├── EmailProvider.ts
│   │   │   └── ResendEmailProvider.ts
│   │   ├── templates/
│   │   │   ├── ListingBrandedEmail.tsx
│   │   │   ├── BrokerPersonalEmail.tsx
│   │   │   └── components/
│   │   ├── render.ts
│   │   └── compliance.ts
│   ├── storage/
│   │   ├── AssetStorage.ts
│   │   ├── AzureBlobAssetStorage.ts
│   │   └── LocalAssetStorage.ts
│   └── shared/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── scripts/
│   ├── migrate-sqlite-v1.ts
│   ├── provision-azure.sh
│   ├── configure-entra.sh
│   ├── configure-custom-domain.sh
│   └── smoke-test.sh
├── infra/
│   ├── bootstrap.bicep
│   ├── main.bicep
│   ├── main.bicepparam.example
│   └── modules/
│       ├── network.bicep
│       ├── monitoring.bicep
│       ├── identity.bicep
│       ├── registry.bicep
│       ├── postgres.bicep
│       ├── storage.bicep
│       ├── keyvault.bicep
│       ├── container-apps.bicep
│       └── auth.bicep
├── docs/
│   ├── AZURE_DEPLOYMENT.md
│   ├── OPERATIONS_RUNBOOK.md
│   ├── DATA_MODEL.md
│   ├── API.md
│   ├── SECURITY.md
│   └── MIGRATION.md
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── openapi.yaml
├── azure.yaml
├── docker-compose.yml
├── Dockerfile
├── package.json
└── README.md
```

移除或不再维护：

- `public/app.js`
- `public/index.html`
- `public/style.css`
- `src/templates/recruitmentEmail.ts`
- SQLite runtime code
- committed `dist/`
- committed `data/*.db`

保留 legacy files 仅限迁移脚本读取；不得在生产运行时依赖。

---

# 6. 数据模型

使用 Prisma，数据库 provider 为 PostgreSQL。ID 统一为 UUID (`@default(uuid())`)。数据库表可使用 Prisma 默认命名或明确 `@@map`，但 API 字段名称以本规范为准。

## 6.1 Enums

至少实现以下枚举：

```prisma
enum UserRole {
  ADMIN
  MARKETER
  VIEWER
}

enum ContactStatus {
  ACTIVE
  INACTIVE
  ARCHIVED
}

enum ContactType {
  BUYER
  SELLER
  INVESTOR
  BROKER
  TENANT
  LANDLORD
  DEVELOPER
  LENDER
  ATTORNEY
  VENDOR
  PAST_CLIENT
  OTHER
}

enum ContactSourceType {
  PAST_CLIENT
  OPEN_HOUSE
  WEBSITE
  BROKER_RELATIONSHIP
  EVENT
  CRM_IMPORT
  MANUAL
  REFERRAL
  LEGACY_EMAIL_SERVICE
  OTHER
}

enum PermissionBasis {
  OPT_IN
  EXISTING_RELATIONSHIP
  BUSINESS_CONTACT
  UNKNOWN
}

enum MarketType {
  REGION
  STATE
  COUNTY
  CITY
  NEIGHBORHOOD
  CUSTOM
}

enum ListingStatus {
  DRAFT
  ACTIVE
  UNDER_CONTRACT
  SOLD
  LEASED
  WITHDRAWN
  ARCHIVED
}

enum TransactionType {
  FOR_SALE
  FOR_LEASE
  SALE_OR_LEASE
}

enum PropertyType {
  OFFICE
  RETAIL
  INDUSTRIAL
  MULTIFAMILY
  LAND
  MIXED_USE
  HOSPITALITY
  SPECIAL_PURPOSE
  BUSINESS
  RESIDENTIAL
  OTHER
}

enum ListingAssetKind {
  HERO
  GALLERY
  FLOORPLAN
  BROCHURE
  LOGO
  OTHER
}

enum SuppressionReason {
  UNSUBSCRIBE
  HARD_BOUNCE
  COMPLAINT
  PROVIDER_SUPPRESSED
  LEGACY_BOUNCE_REVIEW
  INVALID_ADDRESS
  MANUAL
}

enum SuppressionSource {
  USER
  RESEND
  ADMIN
  IMPORT
  SYSTEM
}

enum SenderVerificationStatus {
  UNVERIFIED
  VERIFIED
  SUSPENDED
}

enum CampaignType {
  LISTING
  ANNOUNCEMENT
  LEGACY_ARCHIVE
}

enum CampaignTemplateKey {
  LISTING_BRANDED
  BROKER_PERSONAL
}

enum CampaignStatus {
  DRAFT
  READY
  SNAPSHOTTING
  SCHEDULED
  QUEUED
  SENDING
  PAUSED
  COMPLETED
  CANCELLED
  FAILED
  ARCHIVED
}

enum RecipientSendState {
  PENDING
  RESERVED
  SENDING
  ACCEPTED
  TEMPORARY_FAILED
  PERMANENT_FAILED
  SUPPRESSED
  CANCELLED
  MANUAL_REVIEW
}

enum RecipientDeliveryState {
  UNKNOWN
  DELIVERED
  BOUNCED
  COMPLAINED
  PROVIDER_SUPPRESSED
}

enum SendBatchStatus {
  PREPARING
  SUBMITTING
  ACCEPTED
  PARTIAL
  TEMPORARY_FAILED
  PERMANENT_FAILED
  MANUAL_REVIEW
}

enum SendAttemptOutcome {
  STARTED
  ACCEPTED
  PARTIAL
  TEMPORARY_FAILED
  PERMANENT_FAILED
  UNCERTAIN
}

enum JobStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

enum JobType {
  SNAPSHOT_CAMPAIGN
  DISPATCH_CAMPAIGN
  PROCESS_WEBHOOK_EVENT
  RECOMPUTE_CAMPAIGN_STATS
  IMPORT_CONTACTS
  CLEANUP_EXPIRED_DATA
}

enum ImportStatus {
  UPLOADED
  VALIDATING
  READY
  PROCESSING
  COMPLETED
  FAILED
}

enum UnsubscribeSource {
  VISIBLE_LINK
  ONE_CLICK
  ADMIN
  PROVIDER
}
```

## 6.2 `users`

字段：

- `id`
- `entraObjectId String? @unique`
- `email String`
- `emailNormalized String @unique`
- `displayName String?`
- `role UserRole @default(VIEWER)`
- `isActive Boolean @default(true)`
- `lastLoginAt DateTime?`
- `createdAt`
- `updatedAt`

规则：

- Production 身份由 Easy Auth claims 提供。
- 首位 Admin 只能来自 `BOOTSTRAP_ADMIN_EMAILS`。
- 未预先存在且不在 bootstrap allowlist 的 Entra 用户默认拒绝，不得自动成为 Viewer，除非显式启用 `AUTO_PROVISION_USERS=true`。

## 6.3 `agents`

字段：

- `id`
- `userId String? @unique`
- `firstName`
- `lastName`
- `displayName`
- `email`
- `emailNormalized @unique`
- `phone String?`
- `title String?`
- `licenseNumber String?`
- `headshotUrl String?`
- `signatureHtml String?`
- `isActive Boolean @default(true)`
- timestamps

Agent 用于 listing ownership 与 campaign `Reply-To`，不等同于系统用户。

## 6.4 `contacts`

字段：

- `id`
- `email`
- `emailNormalized @unique`
- `firstName String?`
- `lastName String?`
- `displayName String?`
- `company String?`
- `jobTitle String?`
- `phone String?`
- `contactType ContactType @default(OTHER)`
- `status ContactStatus @default(ACTIVE)`
- `sourceType ContactSourceType`
- `sourceDetail String?`
- `sourceReference String?`
- `permissionBasis PermissionBasis @default(UNKNOWN)`
- `permissionCapturedAt DateTime?`
- `notes String?`
- `customFields Json?`
- `lastSentAt DateTime?`
- `lastEngagedAt DateTime?`
- `sendCount Int @default(0)`
- `archivedAt DateTime?`
- timestamps

Indexes：

- `(status, contactType)`
- `lastEngagedAt`
- `sourceType`
- `createdAt`

规则：

- Contact 本身不保存 `unsubscribed/bounced/complained` 作为唯一真相；global suppression 独立保存。
- Contact archive 不删除 suppression。
- Contact reimport 不得取消 suppression。
- Live campaign 默认排除 `PermissionBasis.UNKNOWN`；Admin 可在 UI 中进行显式、带审计的 override，但不得有全局静默 bypass。

## 6.5 Tags / Markets / Property Interests

实现：

- `tags`：`id`, `name`, `normalizedName @unique`, `color`, timestamps
- `contact_tags`：`contactId`, `tagId`, composite unique
- `markets`：`id`, `name`, `slug @unique`, `type`, `parentId?`, `stateCode?`, timestamps
- `contact_markets`：composite unique
- `property_interests`：`id`, `name`, `slug @unique`, `propertyType?`, timestamps
- `contact_property_interests`：composite unique

不得只依赖 tags 表达全部客户兴趣；market 和 property interest 必须结构化。

## 6.6 `suppressions`

字段：

- `id`
- `email`
- `emailNormalized @unique`
- `reason SuppressionReason`
- `source SuppressionSource`
- `isActive Boolean @default(true)`
- `details Json?`
- `campaignId String?`
- `campaignRecipientId String?`
- `suppressedAt DateTime @default(now())`
- `releasedAt DateTime?`
- `releasedByUserId String?`
- `releaseReason String?`
- timestamps

规则：

1. 发送资格判断必须始终查询 active suppression。
2. Unsubscribe、complaint、hard bounce 默认不可由 Marketer 解除。
3. Admin 解除 suppression 必须输入原因并写 audit log。
4. Reimport、contact update、status update 均不得自动把 `isActive` 改为 false。
5. 若同一邮箱再次触发 suppression，更新当前 active record 的严重原因与 details，并追加 audit/event，不创建互相冲突的 active records。

## 6.7 `listings`

字段至少包括：

- `id`
- `internalName`
- `title`
- `slug @unique`
- `status ListingStatus @default(DRAFT)`
- `transactionType TransactionType`
- `propertyType PropertyType`
- `addressLine1`
- `addressLine2 String?`
- `city`
- `stateCode`
- `postalCode`
- `county String?`
- `marketText String?`
- `latitude Decimal?`
- `longitude Decimal?`
- `currency String @default("USD")`
- `askingPrice Decimal? @db.Decimal(14, 2)`
- `askingRentText String?`
- `buildingSqFt Int?`
- `lotSqFt Decimal? @db.Decimal(14, 2)`
- `unitCount Int?`
- `clearHeightFt Decimal? @db.Decimal(6, 2)`
- `loadingDocks Int?`
- `driveInDoors Int?`
- `parkingSpaces Int?`
- `capRate Decimal? @db.Decimal(7, 4)`
- `zoning String?`
- `yearBuilt Int?`
- `shortDescription String?`
- `longDescription String?`
- `highlights String[]`
- `listingUrl String?`
- `brochureUrl String?`
- `virtualTourUrl String?`
- `externalId String?`
- `mlsId String?`
- `isExclusive Boolean @default(false)`
- `facts Json?`
- `agentId`
- `createdByUserId`
- `updatedByUserId`
- `publishedAt DateTime?`
- timestamps

Indexes：

- `(status, propertyType)`
- `(city, stateCode)`
- `agentId`
- `createdAt`

规则：

- `slug` 是内部/未来使用，不需要本次生成 public landing page。
- Campaign snapshot 后 listing 内容变化不得改变已排队 campaign。
- `ACTIVE` listing 才允许 live send；DRAFT 只允许 preview/test。

## 6.8 `listing_assets`

字段：

- `id`
- `listingId`
- `kind ListingAssetKind`
- `blobName @unique`
- `publicUrl`
- `mimeType`
- `byteSize`
- `width Int?`
- `height Int?`
- `altText String?`
- `sortOrder Int @default(0)`
- `isEmailSafe Boolean @default(false)`
- `originalFileName String?`
- timestamps

上传规则：

- 允许 JPEG、PNG、WebP、PDF；拒绝 SVG、HTML、可执行文件。
- 通过 magic bytes 验证，不仅看 extension/MIME header。
- 单张原图最大 15 MB；PDF 最大 25 MB。
- Hero/Gallery 图片用 `sharp` 去 EXIF，生成 email-safe JPEG：最大 1200×675、quality 82；同时生成 600px thumbnail。
- Email template 只使用永久公开的 `email-safe JPEG URL`，不使用 CID attachment。
- Blob path 使用随机 UUID，不使用用户原始文件名。
- Storage container 只允许公开营销资产；禁止上传联系人 CSV、PII 或 secret。

## 6.9 `sender_profiles`

字段：

- `id`
- `name`
- `fromName`
- `fromEmail`
- `fromEmailNormalized @unique`
- `domain`
- `provider String @default("resend")`
- `verificationStatus SenderVerificationStatus @default(UNVERIFIED)`
- `verifiedAt DateTime?`
- `isDefault Boolean @default(false)`
- `isActive Boolean @default(true)`
- `fixedReplyToEmail String?`
- `dailyLimit Int @default(500)`
- `batchSize Int @default(50)`
- `minBatchIntervalSeconds Int @default(60)`
- `timezone String @default("America/New_York")`
- `sendWindowStart String @default("08:00")`
- `sendWindowEnd String @default("18:00")`
- `allowedWeekdays Int[]`，默认 `[1,2,3,4,5]`
- `warmupEnabled Boolean @default(false)`
- `warmupStartDate DateTime?`
- `warmupSchedule Json?`
- timestamps

Validation：

- `batchSize` 必须为 1–100。
- `dailyLimit` 必须大于 0。
- live send 要求 sender `VERIFIED`、`ACTIVE`。
- 仅允许一个 default sender；通过 transaction 保证。
- 默认 seed：
  - name: `Homix Listings`
  - fromName: `Homix Realty`
  - fromEmail: `listings@listings.homixny.com`
  - domain: `listings.homixny.com`
  - status: `UNVERIFIED`

## 6.10 `saved_audiences`

字段：

- `id`
- `name`
- `description String?`
- `filter Json`
- `lastEstimatedCount Int?`
- `lastEstimatedAt DateTime?`
- `createdByUserId`
- `updatedByUserId`
- timestamps

Filter 必须通过共享 Zod schema 验证，禁止保存任意 SQL。

权威 filter shape：

```ts
interface AudienceFilter {
  contactTypes?: ContactType[];
  sourceTypes?: ContactSourceType[];
  permissionBases?: PermissionBasis[];
  marketIdsAny?: string[];
  propertyInterestIdsAny?: string[];
  tagIdsAny?: string[];
  tagIdsAll?: string[];
  excludeTagIds?: string[];
  engagedWithinDays?: number | null;
  createdAfter?: string | null;
  includeContactIds?: string[];
  excludeContactIds?: string[];
  excludePreviouslySentListing?: boolean;
  requireKnownPermissionBasis?: boolean;
}
```

无论 filter 内容如何，server 都必须追加系统资格条件：

- contact status = ACTIVE
- email syntactically valid
- not archived
- no active suppression
- permission basis 规则满足 live-send policy

Estimate response：

```json
{
  "matched": 328,
  "eligible": 301,
  "suppressed": 14,
  "unknownPermission": 9,
  "invalid": 4,
  "sample": []
}
```

## 6.11 `campaigns`

字段至少包括：

- `id`
- `name`
- `type CampaignType @default(LISTING)`
- `status CampaignStatus @default(DRAFT)`
- `version Int @default(1)`
- `listingId String?`
- `senderProfileId`
- `replyToAgentId String?`
- `savedAudienceId String?`
- `templateKey CampaignTemplateKey`
- `subject`
- `preheader String?`
- `introHtml String?`
- `introText String?`
- `ctaLabel String @default("View Listing")`
- `ctaUrl String?`
- `audienceFilter Json`
- `audienceSnapshotSummary Json?`
- `contentSnapshot Json?`
- `timezone String @default("America/New_York")`
- `scheduledAt DateTime?`
- `startedAt DateTime?`
- `completedAt DateTime?`
- `targetCount Int @default(0)`
- `eligibleCount Int @default(0)`
- `suppressedCount Int @default(0)`
- `acceptedCount Int @default(0)`
- `deliveredCount Int @default(0)`
- `openedCount Int @default(0)`
- `clickedCount Int @default(0)`
- `bouncedCount Int @default(0)`
- `complainedCount Int @default(0)`
- `failedCount Int @default(0)`
- `createdByUserId`
- `updatedByUserId`
- timestamps

Rules：

- `LISTING` campaign 必须有 `listingId`。
- DRAFT 可编辑 listing/content/audience；进入 `SNAPSHOTTING` 后这些字段锁定。
- 若要修改已 snapshot campaign，必须 duplicate 为新 campaign。
- PATCH 使用 `version` 做 optimistic concurrency；冲突返回 409。
- `contentSnapshot` 必须包含 listing、agent、sender、company address、资产 URL 和模板版本。
- `LEGACY_ARCHIVE` / `ARCHIVED` campaign永久只读，不允许prepare、duplicate后直接live send；只能作为历史参考创建新的DRAFT。

## 6.12 `campaign_recipients`

这是整个系统的核心表，必须替代旧系统“每个 chunk 动态查 subscribers”的方式。

字段：

- `id`
- `campaignId`
- `contactId String?`
- `email`
- `emailNormalized`
- `firstName String?`
- `lastName String?`
- `displayName String?`
- `company String?`
- `personalization Json?`
- `unsubscribeTokenHash @unique`
- `sendState RecipientSendState @default(PENDING)`
- `deliveryState RecipientDeliveryState @default(UNKNOWN)`
- `suppressionReason SuppressionReason?`
- `attemptCount Int @default(0)`
- `maxAttempts Int @default(4)`
- `nextAttemptAt DateTime?`
- `claimToken String?`
- `claimedAt DateTime?`
- `claimExpiresAt DateTime?`
- `sendBatchId String?`
- `resendEmailId String? @unique`
- `acceptedAt DateTime?`
- `deliveredAt DateTime?`
- `openedAt DateTime?`
- `clickedAt DateTime?`
- `bouncedAt DateTime?`
- `complainedAt DateTime?`
- `providerSuppressedAt DateTime?`
- `lastProviderEventAt DateTime?`
- `lastErrorCode String?`
- `lastErrorMessage String?`
- timestamps

Constraints / indexes：

- `@@unique([campaignId, emailNormalized])`
- index `(campaignId, sendState, nextAttemptAt)`
- index `emailNormalized`
- index `resendEmailId`
- index `sendBatchId`

Unsubscribe token：

- 使用 `crypto.randomBytes(32).toString("base64url")` 生成 raw token。
- DB 只存 `SHA-256(rawToken)`。
- Raw token 只存在邮件 URL 中，不得写日志。

不要把 opened/clicked 当作覆盖 delivery state 的单一 status；send state、delivery state 和 engagement timestamps 要分开，避免乱序 Webhook 导致状态倒退。

## 6.13 `send_batches`

字段：

- `id`
- `campaignId`
- `senderProfileId`
- `status SendBatchStatus`
- `idempotencyKey @unique`
- `requestHash`
- `recipientCount`
- `acceptedCount @default(0)`
- `failedCount @default(0)`
- `attemptCount @default(0)`
- `nextAttemptAt DateTime?`
- `idempotencyExpiresAt DateTime`
- `startedAt DateTime?`
- `submittedAt DateTime?`
- `completedAt DateTime?`
- `lastErrorCode String?`
- `lastErrorMessage String?`
- timestamps

Rules：

- 一旦创建，batch membership 不变。
- Idempotency key 格式：`campaign/{campaignId}/batch/{batchId}`。
- 同一 batch 所有 automatic retry 必须复用此 key。
- Resend idempotency retention 超过后仍处于“不确定是否已接受”状态时，不得自动创建新 batch 重发；设置 `MANUAL_REVIEW`，避免 duplicate email。

## 6.14 `send_attempts`

每次实际调用provider都必须创建一条attempt，不能只覆盖`send_batches.lastError`。字段：

- `id`
- `sendBatchId`
- `attemptNumber Int`
- `outcome SendAttemptOutcome`
- `idempotencyKey`（与所属batch相同）
- `requestHash`
- `startedAt`
- `completedAt DateTime?`
- `httpStatus Int?`
- `retryAfterSeconds Int?`
- `providerRequestId String?`
- `errorCode String?`
- `errorMessage String?`（sanitize，不保存secret/完整payload）
- `responseSummary Json?`（仅IDs/counts/分类结果，不保存完整邮件正文或recipient list）
- timestamps

Constraints：

- `@@unique([sendBatchId, attemptNumber])`
- index `(sendBatchId, startedAt)`
- 同一batch所有attempt的idempotency key必须相同。
- attempt在provider call前以`STARTED`写入；完成后原子更新outcome。进程在call后崩溃导致仍为STARTED时，recovery按uncertain outcome处理，不能假设未发送。
- Recipient detail通过固定batch membership关联attempt history；无需为每个recipient复制整条HTTP attempt。

## 6.15 `email_events`

Webhook inbox 表：

- `id`
- `webhookId @unique`，值来自 `svix-id`
- `eventType`
- `providerEmailId String?`
- `recipientEmail String?`
- `eventCreatedAt DateTime`
- `campaignRecipientId String?`
- `payload Json`
- `processedAt DateTime?`
- `processingError String?`
- `createdAt`

Webhook HTTP handler 只负责：

1. raw body signature verify
2. schema parse
3. 以 `webhookId` 幂等 insert
4. 创建 `PROCESS_WEBHOOK_EVENT` job
5. 快速返回 200

实际状态更新由 Worker 处理。

## 6.16 `sender_daily_usage`

字段：

- `id`
- `senderProfileId`
- `localDate DateTime @db.Date`
- `timezone`
- `reservedCount Int @default(0)`
- `acceptedCount Int @default(0)`
- `releasedCount Int @default(0)`
- timestamps
- `@@unique([senderProfileId, localDate])`

Quota reservation 必须通过 transaction 与 row lock 实现：

```text
remaining = effectiveDailyLimit - acceptedCount - reservedCount
reserve = min(requested, remaining)
```

Batch 完成后：

- provider accepted：`reservedCount -= accepted`, `acceptedCount += accepted`
- permanent/temporary failure 且确认未发送：释放对应 reservation
- uncertain outcome：reservation 保留到人工处理或安全超时策略完成

## 6.17 `jobs`

字段：

- `id`
- `type JobType`
- `status JobStatus @default(PENDING)`
- `payload Json`
- `uniqueKey String? @unique`
- `attempts Int @default(0)`
- `maxAttempts Int @default(5)`
- `runAt DateTime @default(now())`
- `lockedAt DateTime?`
- `lockedBy String?`
- `lockExpiresAt DateTime?`
- `lastError String?`
- `completedAt DateTime?`
- timestamps

Claim 必须使用 PostgreSQL transaction + `FOR UPDATE SKIP LOCKED`。Worker crash 后，过期 lock 可重新 claim。

## 6.18 其他表

### `contact_imports`

保存 file name、source metadata、status、row counts、created/updated/skipped/suppressed/invalid counts、error report URL、actor、timestamps。

### `unsubscribe_events`

保存 campaign recipient、emailNormalized、source (`VISIBLE_LINK` / `ONE_CLICK` / `ADMIN`)、timestamp、有限的 request metadata。IP 只保存 hash 或不保存，不保存无必要 PII。

### `audit_logs`

字段：actor user、action、entityType、entityId、before Json、after Json、requestId、maskedIp、userAgent、timestamp。

---

# 7. 数据库迁移与 seed

## 7.1 Prisma migrations

- 创建完整 initial PostgreSQL migration。
- 添加必要 indexes、foreign keys、on-delete 行为。
- 对 job claim、quota reservation 等 Prisma 不擅长的并发语句使用**参数化 raw SQL**。
- Migration 中加入数据库约束，例如：
  - batch size 1–100（可在应用层外加 check constraint）
  - daily limit > 0
  - accepted/reserved counts >= 0
- `prisma migrate deploy` 只由 migration job 执行；Web/Worker startup 不自动跑 migration。

## 7.2 Seed

`prisma/seed.ts` 创建：

- 默认 property interests：Office、Retail、Industrial、Multifamily、Land、Mixed Use、Hospitality、Special Purpose、Business、Residential
- 常用 markets：Long Island、Nassau County、Suffolk County、Queens、Brooklyn、Manhattan、New Jersey；数据可在 UI 修改
- 默认 tags 示例：Past Client、Broker、Investor、1031、High Priority
- 默认 sender profile（UNVERIFIED）
- 默认 company setting 只保存 company name；实体地址必须由环境变量或 Admin 配置后才能 live send

Seed 必须幂等。

## 7.3 Legacy SQLite migration utility

实现 `scripts/migrate-sqlite-v1.ts`：

- 输入参数：`--sqlite <path>`、`--dry-run`、`--apply`
- 读取旧 `subscribers`, `tags`, `subscriber_tags`, `campaigns`, `send_logs`
- subscribers → contacts
- 旧 status：
  - `unsubscribed` → active suppression `UNSUBSCRIBE`
  - `bounced` → `LEGACY_BOUNCE_REVIEW`（无法证明hard/soft时保守suppress并等待Admin review）
  - `complained` → `COMPLAINT`
  - `suppressed` → `PROVIDER_SUPPRESSED`
- 保留 tags
- 旧 campaigns 导入为只读 `LEGACY_ARCHIVE` + `ARCHIVED`；若数据不足以可靠导入则跳过并清楚报告
- 不导入 secret、session、rate-limit data
- 输出 migration summary 和 error CSV
- 默认 dry-run；`--apply` 才写入 PostgreSQL
- 可重复运行，不产生重复 contacts/tags/suppressions


---

# 8. 身份认证、授权与安全边界

## 8.1 Production：Azure Container Apps Easy Auth + Microsoft Entra ID

生产环境使用 `AUTH_MODE=azure-easyauth`。

Azure Container Apps auth config：

- Provider：Microsoft Entra ID，single tenant
- `requireHttps = true`
- 默认未认证请求重定向到 Microsoft login
- 配置 `excludedPaths`，确保以下公共路径无需登录：
  - `/health/live`
  - `/health/ready`
  - `/api/public/webhooks/resend`
  - `/api/public/unsubscribe/*`
  - `/unsubscribe*`
  - 必要的公开 asset path（若由 Web app 代理；默认 Blob 直接公开）
- 不要把整个 `/api` 排除认证。

Backend 从以下 header/claims 提取用户：

- `X-MS-CLIENT-PRINCIPAL`
- `X-MS-CLIENT-PRINCIPAL-ID`
- `X-MS-CLIENT-PRINCIPAL-NAME`

实现 `EasyAuthPrincipalParser`：

1. 对 `X-MS-CLIENT-PRINCIPAL` 做 base64 decode。
2. Zod 验证 claims array。
3. 优先取得 object ID、email/upn、display name。
4. upsert/login user，但遵守预注册/allowlist 规则。
5. 将 DB role 注入 request context。

不要直接信任客户端自行传来的 role。Production 只在 Azure Container Apps 环境下信任 Easy Auth headers。

## 8.2 Local development auth

`AUTH_MODE=local` 时：

- 提供本地 dev login，只在 `NODE_ENV !== "production"` 可用。
- 使用 HttpOnly、Secure（HTTPS 时）、SameSite=Lax session cookie。
- 本地账号来自 `LOCAL_ADMIN_EMAIL`。
- `DEV_BYPASS_AUTH` 默认 false，生产环境检测到 true 必须启动失败。
- 保留旧 `API_SECRET` 的兼容登录不是目标；可删除。

## 8.3 Authorization middleware

实现：

```ts
requireAuthenticatedUser()
requireRole("ADMIN")
requireAnyRole(["ADMIN", "MARKETER"])
```

所有 service 层 mutation 仍需接收 actor context，不能只在 route 层检查。

## 8.4 CSRF / CORS

- Production CORS 只允许 same-origin；默认不需要 cross-origin API。
- 所有 authenticated mutation 需要 `X-Homix-CSRF: 1` header，并验证 `Origin`/`Referer` 是 `BASE_URL`。
- Public one-click unsubscribe 与 Resend webhook 不走 CSRF middleware。
- Cookie 不得跨站设置 `SameSite=None`，除非未来有明确需求。

## 8.5 HTTP security

- Helmet
- `trust proxy = 1`
- Request ID middleware
- JSON body limit 1 MB
- multipart upload limit 按资产规则设置
- 严格 URL validation：只允许 `https:`；local development 可允许 `http://localhost`
- HTML sanitize allowlist
- 关闭 Express `x-powered-by`
- CSP 允许应用自身、Azure Blob public asset domain、必要 inline email preview sandbox；不要使用宽泛 `*`
- Email preview 使用 sandboxed iframe + `srcDoc`，禁止脚本
- Rate limits：
  - public unsubscribe：每 IP 60/小时
  - webhook：不以低阈值阻挡合法 provider，但必须 signature verified；设置合理 payload size
  - uploads：20/小时/用户
  - admin API：合理高阈值并记录异常

---

# 9. Contacts 与 CSV Import

## 9.1 Contacts list

UI 支持：

- 搜索 email/name/company
- filter contact type、source、permission basis、status、market、interest、tag、suppression
- sort created/last engaged/last sent
- cursor/page pagination
- bulk tag、bulk market、bulk property interest、archive
- 查看 contact campaign history 和 engagement

不得在普通列表 API 返回不必要的完整 audit payload。

## 9.2 Contact create/update

- Server normalize email。
- Duplicate email 返回 409，并提供 existing contact ID。
- 更新 email 时先检查新 email 的 global suppression；不得因换 email UI 操作清除旧 suppression。
- Archived contact 可由 Admin/Marketer restore，但 active suppression 仍然有效。

## 9.3 CSV import workflow

实现 4 步：

1. Upload
2. Preview / column mapping
3. Validation summary
4. Apply import

支持常见 headers：

```text
email, first_name, last_name, name, company, title, phone,
contact_type, source, source_detail, permission_basis,
markets, property_interests, tags, notes
```

Requirements：

- `email` 必填。
- UTF-8 与 UTF-8 BOM。
- 单文件初期限制 50,000 rows / 20 MB。
- Import 在 worker 中执行，不阻塞 HTTP。
- Email dedupe by normalized email。
- 默认 upsert：非空新值更新旧值；空 CSV 字段不覆盖已有非空值。
- Tags/markets/interests 使用 `;` 分隔。
- 未识别 reference data：可选择创建为 custom value，默认在 preview 中要求明确 mapping。
- Active suppression 永不因 import 被清除。
- 若导入 email 已 suppression，contact 可创建/更新，但结果计入 `suppressedCount`。
- 生成 invalid/error CSV。
- Import source 与 permission basis 必须明确；不得默认把未知名单标记为 OPT_IN。

## 9.4 Export

- Admin/Marketer 可导出 filtered contacts；Viewer 默认不可。
- CSV 中增加 `suppressed`, `suppression_reason`。
- Formula injection protection。
- Audit export action 与 row count。

---

# 10. Listings 与 Assets

## 10.1 Listing screens

### Listing list

显示：

- Hero thumbnail
- Title/address
- Property type
- Transaction type
- Price/rent
- Status
- Agent
- Active campaign count
- Updated time

支持 filter、search、duplicate、archive。

### Listing editor

分区：

1. Basic information
2. Address / market
3. Pricing
4. Property facts
5. Marketing descriptions
6. Highlights（可排序）
7. Links
8. Agent
9. Assets
10. Status / publication

Validation：

- title、address、city、state、postal、property type、transaction type、agent 必填。
- ACTIVE 前至少有一张 `HERO` email-safe asset。
- FOR_SALE 至少有 asking price 或明确 `Price upon request` setting；不要用 0 表示未提供。
- CTA URL 默认 listing URL；若没有，campaign creation 时必须提供。

## 10.2 Asset storage abstraction

定义：

```ts
interface AssetStorage {
  put(input: PutAssetInput): Promise<StoredAsset>;
  delete(blobName: string): Promise<void>;
  getPublicUrl(blobName: string): string;
}
```

Implementations：

- `LocalAssetStorage`：本地开发保存到 `LOCAL_ASSET_DIR`，由 Express public route 提供。
- `AzureBlobAssetStorage`：生产通过 `DefaultAzureCredential` / managed identity 上传，不使用 account key。

Azure container：`marketing-assets`。

Asset delete：

- DB transaction 先标记 pending delete 或先验证引用。
- 已在 campaign content snapshot 中使用的 URL 不得物理删除；改为 soft-delete/retain，直到 retention policy 允许。
- Listing editor 中“删除”只从当前 listing 隐藏已被历史 campaign 引用的 asset。

## 10.3 Email image requirements

- Final email HTML 使用绝对 HTTPS URL。
- 不引用需要登录或短期 SAS 的 URL。
- Hero image width attribute 600，源图最大 1200px；responsive `width:100%;height:auto`。
- 设置 alt text。
- 不使用 background-image 承载关键信息。
- 不在图片中放唯一价格/地址信息；核心字段同时是 HTML text。

---

# 11. Audience Builder

## 11.1 UI

Audience builder 支持：

- Contact type
- Source
- Permission basis
- Market any
- Property interest any
- Tag any / all / exclude
- Engaged within N days
- Created after
- Include specific contacts
- Exclude specific contacts
- Exclude contacts previously sent the same listing
- Require known permission basis

每次改变 filter 后 debounce 调用 estimate API，显示：

- matched
- eligible
- suppressed
- unknown permission
- invalid
- 10 条 sample

## 11.2 Query semantics

- `tagIdsAny`: 至少命中一个
- `tagIdsAll`: 必须全部命中
- `excludeTagIds`: 任一命中即排除
- `marketIdsAny` 和 `propertyInterestIdsAny` 各自为 OR，不同维度之间为 AND
- includeContactIds 仍要遵守 suppression；不能 bypass
- excludePreviouslySentListing：排除同 listing 下已有 provider accepted 的联系人

## 11.3 Saved Audience

- 可从 filter 保存/更新/duplicate。
- Campaign 保存 audience filter snapshot；Saved Audience 后续变化不得改变已创建 campaign，除非用户重新 apply。

---

# 12. Campaign Wizard 与状态机

## 12.1 五步 Campaign Wizard

### Step 1 — Listing

- 选择 ACTIVE listing
- 显示 listing preview
- 可 duplicate 一个历史 campaign 作为起点

### Step 2 — Audience

- 选择 Saved Audience 或临时构建 filter
- 显示 estimate/sample/risk warnings
- live send 不允许 eligible count = 0

### Step 3 — Sender

- 选择 VERIFIED sender profile
- 选择 Reply-To agent
- 显示 From 与 Reply-To 最终值
- 未 verified sender 只允许 test send 到 allowlist

### Step 4 — Content

- template: `LISTING_BRANDED` / `BROKER_PERSONAL`
- subject
- preheader
- intro rich text
- CTA label / URL
- listing facts/highlights selector
- desktop/mobile preview
- plain-text preview

### Step 5 — Review & Send

- audience counts
- suppression/permission warnings
- sender quota remaining
- next allowed send window
- estimated number of batches
- test send status
- schedule or send now
- confirmation dialog 必须显示准确 eligible recipient count

## 12.2 Test Send semantics

- `disabled` mode只允许preview，不允许外部test send。
- `sandbox`与`live` mode的test recipient必须在 `EMAIL_TEST_ALLOWLIST`。
- Test send使用当前draft内容即时render，但不创建正式 `campaign_recipients`，不消耗正式sender daily quota。
- Subject自动加 `[TEST]`，并可添加 `X-Homix-Test: true`。
- Footer仍包含company address与unsubscribe说明，但test token必须是隔离token，不得对任何真实contact创建suppression。
- 使用provider single-send或专用test batch；仍使用idempotency key防止双击。
- 保存test recipient（masked）、template/version、provider result、执行用户与时间到audit/test-send record。
- Campaign live send readiness要求最近一次成功test send对应当前campaign version；内容被修改后旧test result失效。

## 12.3 Campaign state transitions

允许：

```text
DRAFT -> READY
READY -> SNAPSHOTTING
SNAPSHOTTING -> QUEUED
SNAPSHOTTING -> SCHEDULED
SCHEDULED -> QUEUED
QUEUED -> SENDING
SENDING -> PAUSED
PAUSED -> SENDING
SENDING -> COMPLETED
READY/SCHEDULED/QUEUED/PAUSED -> CANCELLED
SNAPSHOTTING/SENDING -> FAILED
```

禁止：

- COMPLETED 重新发送同一 campaign；必须 duplicate。
- CANCELLED 恢复。
- SNAPSHOTTING 后编辑 content/audience/listing/sender。
- DRAFT 直接置 COMPLETED。

## 12.4 Snapshot transaction

当用户点击 schedule/send：

1. 使用 campaign row lock，验证 status/version。
2. 验证 listing、sender、company address、CTA、template、audience。
3. 将 campaign 改为 `SNAPSHOTTING`。
4. 保存 immutable `contentSnapshot`：
   - listing data
   - selected facts/highlights
   - hero/gallery URLs
   - agent signature
   - sender details
   - company name/address
   - template version
   - subject/preheader/intro/CTA
5. Resolve audience。
6. 为所有 matched contacts 创建 `campaign_recipients`：
   - eligible → `PENDING`
   - current suppression → `SUPPRESSED`
   - unknown permission/invalid → `SUPPRESSED` 或明确 ineligible reason
7. 生成每个 recipient 的 unsubscribe token hash。
8. 保存 audience snapshot summary/counts。
9. 创建唯一 job：`SNAPSHOT_CAMPAIGN/{campaignId}` 或 `DISPATCH_CAMPAIGN/{campaignId}`。
10. 设置 `SCHEDULED` 或 `QUEUED`。

整个流程需可重试且幂等。若已有 recipients，重复 snapshot job 不重复插入。

## 12.5 Suppression double-check

即使 recipient 在 snapshot 时 eligible，Worker 在真正构造 Resend request 前必须再次检查：

- global suppression
- campaign not paused/cancelled
- sender active/verified

若此时刚退订，recipient 改为 `SUPPRESSED` 并释放 quota，不发送。

## 12.6 Pause / Resume / Cancel

- Pause：停止 claim 新 recipient；已被 provider accepted 的邮件不能撤回。
- Resume：从剩余 PENDING/TEMPORARY_FAILED 继续。
- Cancel：将未发送 recipient 设为 CANCELLED；已 accepted 保留状态。
- 所有操作写 audit log。

---

# 13. Email Templates

## 13.1 Template 1：`LISTING_BRANDED`

结构：

1. Preheader hidden text
2. Homix Realty header
3. Hero image
4. `NEW LISTING` eyebrow
5. Listing title/address area
6. Price/rent
7. 4–6 key facts
8. Short intro
9. Highlights bullets
10. CTA button
11. Agent signature/contact
12. Brokerage/compliance footer
13. Visible unsubscribe link

## 13.2 Template 2：`BROKER_PERSONAL`

更像经纪人直接沟通：

1. Simple text header，无大型 logo bar
2. `Hi {{first_name}},`
3. Intro paragraph
4. Compact hero + property summary
5. Facts/highlights
6. CTA text/button
7. Agent signature
8. Compliance footer

## 13.3 Template implementation

- 使用 React Email 组件，最终 render 为 HTML string。
- Table-based、600px max-width、inline styles。
- 不使用 JavaScript、form、video、external CSS。
- Intro HTML 仅允许：`p`, `br`, `strong`, `em`, `ul`, `ol`, `li`, `a`。
- 所有 listing/contact input escape。
- Link scheme 只允许 HTTPS；localhost test 例外。
- 每封生成完整 plain-text alternative。
- Template renderer 是纯函数，使用 frozen snapshot，不在发送时重新读 listing。
- 给 template 设版本，例如 `listing-branded@1`；版本写进 content snapshot。

## 13.4 Merge fields

只允许经过定义的 merge fields：

```text
{{first_name}}
{{full_name}}
{{company}}
{{agent_name}}
{{listing_title}}
{{listing_city}}
```

缺失 first name 时使用自然 fallback，例如 `Hi there,`，不得出现空字符串或 `undefined`。

## 13.5 Subject and content checks

发送前验证：

- subject 1–150 chars
- no newline/header injection
- company postal address 非空且不是 placeholder
- visible unsubscribe link present
- `List-Unsubscribe` headers present
- plain text 非空
- no `javascript:` URLs
- no unresolved `{{...}}`
- no localhost asset URLs in live mode
- no unverified sender

---

# 14. Unsubscribe 与 Suppression

## 14.1 Visible unsubscribe

Email footer link：

```text
GET /unsubscribe?token=<raw-token>
```

GET **只显示确认页面，不立即退订**，防止 link scanner 自动访问导致误退订。

用户点击确认后：

```text
POST /api/public/unsubscribe/confirm
Content-Type: application/x-www-form-urlencoded

token=<raw-token>
```

结果：

- 创建/激活 global `UNSUBSCRIBE` suppression
- 写 unsubscribe event
- 将该 contact 在未来 campaign 中排除
- 当前尚未发送的 recipient 立即设为 SUPPRESSED
- 返回简单成功页面

## 14.2 RFC 8058 one-click

Headers：

```text
List-Unsubscribe: <https://marketing.homixny.com/api/public/unsubscribe/one-click?token=...>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

Endpoint 必须接受 provider/client 的 POST，立即全局退订并返回 200/204，不要求登录、验证码或二次确认。

## 14.3 Suppression severity

若一个邮箱有多个原因，保留更严格原因：

```text
COMPLAINT > UNSUBSCRIBE > HARD_BOUNCE > PROVIDER_SUPPRESSED > LEGACY_BOUNCE_REVIEW > INVALID_ADDRESS > MANUAL
```

不要因之后收到 delivered/opened Webhook 自动解除 suppression。

---

# 15. Resend Provider 与发送引擎

## 15.1 Provider abstraction

```ts
interface EmailProvider {
  sendBatch(
    messages: ProviderMessage[],
    options: { idempotencyKey: string }
  ): Promise<ProviderBatchResult>;

  sendSingle(
    message: ProviderMessage,
    options: { idempotencyKey: string }
  ): Promise<ProviderSingleResult>;

  verifyWebhook(input: {
    rawBody: string;
    headers: Record<string, string | undefined>;
  }): Promise<VerifiedWebhookEvent>;
}
```

Business service 不直接 import Resend SDK。

## 15.2 Batch behavior

- 每次 API batch 最多 100 recipients。
- 使用 sender profile 的 `batchSize`，最终 `min(profile.batchSize, 100)`。
- 每封带 provider tags：
  - `campaign_id`
  - `recipient_id`
  - `listing_id`
- From：sender profile。
- Reply-To：campaign agent，fallback 到 fixed reply-to。
- 每个 recipient 使用自己的 unsubscribe URL/header。
- 在调用 Resend 前对整个 batch 做本地 schema/content validation；任何 invalid message 要在组 batch 前转为 recipient permanent failure，避免一个坏 payload 导致整个 Resend batch request失败。
- Provider adapter必须按输入 index稳定映射结果，不以返回顺序或 email地址猜测 recipient。

## 15.3 Worker dispatch algorithm

权威流程：

```text
1. Claim one due DISPATCH_CAMPAIGN job with SKIP LOCKED
2. Verify campaign status is SENDING/QUEUED and due
3. Verify current send window and weekday
4. Open DB transaction
5. Lock/create sender_daily_usage row
6. Calculate effective daily remaining quota
7. Claim up to min(batchSize, quota remaining) recipients using SKIP LOCKED
8. Re-check global suppression
9. Mark recipients RESERVED
10. Increase reservedCount
11. Create immutable send_batch + idempotency key
12. Attach recipients to batch and mark SENDING
13. Commit transaction
14. Render messages from frozen snapshot
15. Call Resend batch endpoint with same idempotency key
16. Persist per-index accepted/error results in transaction
17. Transfer/release quota reservations
18. Schedule next dispatch after min interval, next send window, or next local day
19. Recompute campaign status/counters
```

## 15.4 Effective daily limit

```text
effective limit = sender.dailyLimit
if warmup enabled:
  effective limit = min(sender.dailyLimit, warmup schedule limit for local day)
```

Warmup schedule 是 Admin 可配置 JSON，例如：

```json
[
  { "day": 1, "limit": 50 },
  { "day": 2, "limit": 100 },
  { "day": 3, "limit": 200 },
  { "day": 4, "limit": 300 },
  { "day": 5, "limit": 500 }
]
```

超过最后一项后使用 sender dailyLimit。必须真实 enforce，而不是只改变 interval。

## 15.5 Error classification

### Temporary / retryable

- network timeout/reset
- Resend 429
- Resend 5xx
- provider temporary error

处理：

- batch `TEMPORARY_FAILED`
- recipient `TEMPORARY_FAILED`
- exponential backoff with jitter
- respect `Retry-After`
- 复用同一 batch 和 idempotency key
- 最多 4 attempts

### Permanent

- invalid recipient
- invalid sender/payload
- authorization failure that requires operator action
- provider explicit permanent rejection

处理：

- recipient `PERMANENT_FAILED`
- 可确认未接受时释放 quota
- campaign 可继续发送其他 recipients
- 配置/authorization failure 应 pause campaign 并 alert，不要让所有收件人各重试 4 次

### Uncertain outcome

若 request timeout 后无法确认 provider 是否接受：

- 使用同一 idempotency key 在 24 小时窗口内 retry。
- 过了 idempotency retention 且仍不确定，不创建新 key；batch/recipients 进入 `MANUAL_REVIEW`。
- Admin UI 显示明确 warning 和处理选项。

## 15.6 Delivery mode safety switch

环境变量：

```text
EMAIL_DELIVERY_MODE=disabled|sandbox|live
EMAIL_TEST_ALLOWLIST=comma-separated emails
```

- `disabled`：不调用 Resend；只允许 preview。
- `sandbox`：test send 与 campaign 只允许发送到 allowlist；任何其他 recipient 被拒绝。
- `live`：允许真实 campaign，但必须通过 production readiness checks。

新的 Azure environment 默认 `disabled`，人工完成 DNS、Webhook、company address、sender test 后改为 `live`。

## 15.7 Campaign completion

Campaign 在以下条件全部成立时设 `COMPLETED`：

- 没有 PENDING/RESERVED/SENDING/TEMPORARY_FAILED recipients
- 没有 due/running dispatch jobs
- 允许存在 PERMANENT_FAILED/SUPPRESSED/CANCELLED

`COMPLETED` 不是“全部 delivered”；它表示所有发送尝试已经结束。Analytics 分开显示 accepted/delivered。

---

# 16. Resend Webhook

## 16.1 Route

```text
POST /api/public/webhooks/resend
```

要求：

- Express route 获取原始 body；不能先经过 `express.json()` 改写。
- 验证 `svix-id`, `svix-timestamp`, `svix-signature`。
- 无效 signature 返回 400/401。
- Duplicate `svix-id` 返回 200，不重复处理。
- Valid event 持久化后尽快返回 200。

## 16.2 Event types

至少处理：

- `email.sent`
- `email.delivered`
- `email.delivery_delayed`
- `email.bounced`
- `email.complained`
- `email.suppressed`
- `email.opened`
- `email.clicked`
- `email.failed`（若 provider event 支持）

未知 event 仍保存 raw payload，标记 processed/no-op，不返回错误导致 provider 无限 retry。

## 16.3 Event processing rules

- 根据 provider email ID 找 campaign recipient。
- 使用 event 自带 `created_at`，不要用收到 Webhook 的时间代替 provider event 时间。
- Webhook 可能乱序，不得让较早 event 覆盖较新 final state。
- `openedAt`、`clickedAt` 保存首次时间；多次 event 不重复计 unique count。
- `bounced`：delivery state BOUNCED；hard bounce 创建 suppression。
- `complained`：delivery state COMPLAINED；立即创建 complaint suppression。
- `suppressed`：delivery state PROVIDER_SUPPRESSED；创建 suppression。
- `delivered` 不得解除已有 complaint/bounce suppression。
- `clicked` 不必人为推断 `openedAt`；各指标独立。
- 无法匹配 recipient 的 valid webhook 仍保留，标记 orphan，供运维查看。

## 16.4 Analytics counters

不要在多个地方手工 `+1` 导致重复。实现一个幂等 stats recompute service，按 recipient unique timestamps/states计算并更新 campaign counters。

Rates：

```text
delivery rate = delivered / accepted
open rate = unique opened / delivered
click rate = unique clicked / delivered
bounce rate = bounced / accepted
complaint rate = complained / accepted
```

UI 把 open rate 标记为 estimated，因为部分邮件客户端会预加载 tracking pixel。

---

# 17. API 设计

统一前缀：`/api/v2`。所有 request/response 用 JSON，文件上传除外。OpenAPI 写入 `openapi.yaml`，并与路由保持一致。

## 17.1 Auth / Users

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/v2/auth/me` | Authenticated | 当前用户/role |
| POST | `/api/v2/auth/dev-login` | Local only | 本地开发登录 |
| POST | `/api/v2/auth/logout` | Authenticated | logout / Easy Auth redirect info |
| GET | `/api/v2/users` | ADMIN | 用户列表 |
| POST | `/api/v2/users` | ADMIN | 预注册用户 |
| PATCH | `/api/v2/users/:id` | ADMIN | role/active |

## 17.2 Agents

CRUD：

```text
GET    /api/v2/agents
POST   /api/v2/agents
GET    /api/v2/agents/:id
PATCH  /api/v2/agents/:id
DELETE /api/v2/agents/:id   // soft deactivate
```

## 17.3 Contacts / Imports

```text
GET    /api/v2/contacts
POST   /api/v2/contacts
GET    /api/v2/contacts/:id
PATCH  /api/v2/contacts/:id
DELETE /api/v2/contacts/:id        // archive
POST   /api/v2/contacts/:id/restore
POST   /api/v2/contacts/bulk-update
GET    /api/v2/contacts/export

POST   /api/v2/contact-imports/upload
POST   /api/v2/contact-imports/:id/validate
POST   /api/v2/contact-imports/:id/apply
GET    /api/v2/contact-imports/:id
GET    /api/v2/contact-imports/:id/errors.csv
```

## 17.4 Reference data

CRUD：

```text
/api/v2/tags
/api/v2/markets
/api/v2/property-interests
```

Delete 前检查引用；优先 deactivate/merge。

## 17.5 Suppressions

```text
GET  /api/v2/suppressions
POST /api/v2/suppressions/manual
POST /api/v2/suppressions/:id/release   // ADMIN only + reason
```

## 17.6 Listings / Assets

```text
GET    /api/v2/listings
POST   /api/v2/listings
GET    /api/v2/listings/:id
PATCH  /api/v2/listings/:id
POST   /api/v2/listings/:id/duplicate
POST   /api/v2/listings/:id/archive
POST   /api/v2/listings/:id/assets
PATCH  /api/v2/listings/:id/assets/reorder
DELETE /api/v2/listings/:id/assets/:assetId
```

## 17.7 Audiences

```text
POST   /api/v2/audiences/estimate
GET    /api/v2/audiences
POST   /api/v2/audiences
GET    /api/v2/audiences/:id
PATCH  /api/v2/audiences/:id
POST   /api/v2/audiences/:id/duplicate
DELETE /api/v2/audiences/:id
```

## 17.8 Sender profiles

```text
GET   /api/v2/sender-profiles
POST  /api/v2/sender-profiles             // ADMIN
PATCH /api/v2/sender-profiles/:id          // ADMIN
POST  /api/v2/sender-profiles/:id/verify   // ADMIN manual confirmation + audit
POST  /api/v2/sender-profiles/:id/suspend  // ADMIN
GET   /api/v2/sender-profiles/:id/quota
```

`verify` 不代表系统伪造 DNS 验证；UI 必须让 Admin 确认已在 Resend 验证，并执行 test send。若实现 Resend Domain API check，可作为额外验证，但不要阻塞基础实现。

## 17.9 Campaigns

```text
GET    /api/v2/campaigns
POST   /api/v2/campaigns
GET    /api/v2/campaigns/:id
PATCH  /api/v2/campaigns/:id
POST   /api/v2/campaigns/:id/duplicate
POST   /api/v2/campaigns/:id/preview
POST   /api/v2/campaigns/:id/test-send
POST   /api/v2/campaigns/:id/mark-ready
POST   /api/v2/campaigns/:id/schedule
POST   /api/v2/campaigns/:id/send-now
POST   /api/v2/campaigns/:id/pause
POST   /api/v2/campaigns/:id/resume
POST   /api/v2/campaigns/:id/cancel
GET    /api/v2/campaigns/:id/stats
GET    /api/v2/campaigns/:id/recipients
GET    /api/v2/campaigns/:id/recipients/:recipientId
GET    /api/v2/campaigns/:id/events
GET    /api/v2/campaigns/:id/export.csv
```

`send-now` 和 `schedule` 应接受 client idempotency header，防止用户双击触发两次 snapshot job。

## 17.10 Dashboard / Audit

```text
GET /api/v2/dashboard/summary
GET /api/v2/dashboard/recent-campaigns
GET /api/v2/audit-logs             // ADMIN; Marketer limited to own operations
GET /api/v2/system/readiness       // ADMIN
```

## 17.11 Public

```text
GET  /health/live
GET  /health/ready
POST /api/public/webhooks/resend
GET  /unsubscribe
POST /api/public/unsubscribe/confirm
POST /api/public/unsubscribe/one-click
```

## 17.12 Health semantics

- `/health/live`：进程活着即 200，不查外部服务。
- `/health/ready`：检查 PostgreSQL query；Web role 可检查 storage configuration；不调用 Resend。
- Container Apps liveness/readiness probe 使用这两个路径。

---

# 18. Admin UI

## 18.1 Navigation

```text
Dashboard
Listings
Contacts
Audiences
Campaigns
Analytics
Settings
```

Settings 子项：Agents、Sender Profiles、Tags、Markets、Property Interests、Users、Audit Log、System Readiness。

## 18.2 Campaign List

显示：Campaign name、Listing、Template、Sender、Audience/eligible count、Status、Scheduled/Sent time、Accepted、Delivered、Clicked、Bounce、Complaint、Created by。支持按status、date range、listing、sender、creator筛选，并提供Duplicate与进入detail操作；不得在list页提供绕过review的直接live-send快捷键。

## 18.3 Dashboard

显示：

- Active listings
- Contacts / eligible / suppressed
- Campaigns sent last 30 days
- Accepted / delivered / clicked
- Bounce rate / complaint rate
- Sender daily quota usage
- Recent campaigns
- Action-required cards：unverified sender、failed batch、manual review、Webhook stale、company address missing

## 18.4 Campaign detail

Tabs：

- Overview
- Recipients
- Delivery events
- Content snapshot
- Audit history

Recipient table columns：

- email/name/company
- send state
- delivery state
- accepted/delivered/opened/clicked timestamps
- attempts
- last error
- suppression reason

支持按状态 filter 与 CSV export。

## 18.5 UX safety

- Send 按钮不可用时显示明确原因。
- Send confirmation 不使用模糊 “Are you sure?”；显示 sender、listing、recipient count、schedule、quota。
- Live send 前必须至少成功 test send 一次；保存 test send audit timestamp。
- Manual review batch 用红色 action card，不自动重发。
- Unsuppress 要二次确认与文字原因。
- 所有时间显示 `ET` 并可 hover 查看 UTC。
- 列表 loading、empty、error states 完整。
- UI desktop-first，但 1024px 宽仍可使用。
- 不伪造 Homix logo；无提供 logo 时使用文字品牌。

---

# 19. 配置与环境变量

实现 `src/config/env.ts`，启动时用 Zod 校验。`.env.example` 至少包含：

```dotenv
NODE_ENV=development
APP_ROLE=web
PORT=3000
BASE_URL=http://localhost:3000
DEFAULT_TIMEZONE=America/New_York
LOG_LEVEL=info

DATABASE_URL=postgresql://homix:homix@localhost:5432/homix_marketing?schema=public
DIRECT_DATABASE_URL=postgresql://homix:homix@localhost:5432/homix_marketing?schema=public

AUTH_MODE=local
LOCAL_ADMIN_EMAIL=admin@homixny.com
BOOTSTRAP_ADMIN_EMAILS=admin@homixny.com
AUTO_PROVISION_USERS=false
ALLOWED_EMAIL_DOMAINS=homixny.com
DEV_BYPASS_AUTH=false

RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
EMAIL_DELIVERY_MODE=disabled
EMAIL_TEST_ALLOWLIST=admin@homixny.com

STORAGE_PROVIDER=local
LOCAL_ASSET_DIR=./data/assets
AZURE_STORAGE_ACCOUNT_URL=
AZURE_STORAGE_CONTAINER=marketing-assets
PUBLIC_ASSET_BASE_URL=http://localhost:3000/public/assets

COMPANY_NAME=Homix Realty
COMPANY_POSTAL_ADDRESS=REQUIRED_BEFORE_LIVE_SEND
COMPANY_WEBSITE=https://homixny.com

APPLICATIONINSIGHTS_CONNECTION_STRING=
WORKER_POLL_INTERVAL_MS=2000
JOB_LOCK_SECONDS=120
WEBHOOK_RETENTION_DAYS=90
AUDIT_RETENTION_DAYS=365
```

Rules：

- Production + local auth → startup error。
- Production + `DEV_BYPASS_AUTH=true` → startup error。
- `EMAIL_DELIVERY_MODE=live` 且 company address placeholder → sending readiness false。
- 所有 role 缺少 DB config → startup error。
- `APP_ROLE=worker` 在 `sandbox`/`live` 模式缺少 Resend config → startup error；`disabled` 模式允许无 Resend key 启动，以便首次 Azure 部署、Webhook以外的维护任务与 readiness 验证。
- Web role在 disabled mode仍可启动管理后台。
- Azure Postgres connection 必须要求 TLS (`sslmode=require`)。

Sender name/email 不再以环境变量作为唯一数据源；sender profile 存 DB。环境变量仅可用于 seed default，之后以 DB 为准。

---

# 20. Observability 与运维

## 20.1 Logging

- JSON structured logs
- fields：timestamp、level、serviceRole、requestId、jobId、campaignId、batchId、recipientId、eventId
- 不记录 raw recipient payload、unsubscribe token、Webhook secret、API key
- Email mask 示例：`j***@example.com`
- Worker 每次 batch 输出 aggregate，不逐个打印全部地址

## 20.2 Application Insights

使用 Azure Monitor OpenTelemetry：

- HTTP traces
- DB spans（注意不记录参数中的 PII）
- Resend outbound spans
- Worker job spans
- exceptions
- custom events：campaign_queued、batch_accepted、campaign_completed、suppression_created

## 20.3 Alerts / readiness

IaC 支持可选 `alertEmail` parameter，并创建或文档化以下 alerts：

- Web 5xx spike
- readiness failure
- worker no heartbeat > 10 minutes
- job failure rate
- manual review batch count > 0
- complaint rate above configurable threshold
- bounce rate above configurable threshold

Worker 每 60 秒更新 heartbeat（DB 或 custom metric）；Dashboard readiness 显示最后 heartbeat。

## 20.4 Retention / cleanup

Scheduled cleanup job：

- processed raw Webhook payload：90 days 后删除或脱敏
- expired local sessions
- stale job locks
- orphan unreferenced assets（保留期后）
- audit logs 默认至少 365 days
- active suppression indefinite retention
- campaign content/recipient audit 不自动短期删除

---

# 21. 本地开发环境

## 21.1 Docker Compose

`docker-compose.yml` 包含：

- PostgreSQL
- 可选 Azurite；默认 local asset adapter 即可
- web process
- worker process（可通过 profile 启动）

推荐命令：

```bash
npm ci
cp .env.example .env
npm run db:up
npm run prisma:migrate:dev
npm run db:seed
npm run dev
```

## 21.2 Package scripts

至少提供：

```json
{
  "dev": "...web + client...",
  "dev:web": "...",
  "dev:worker": "...",
  "build": "npm run build:client && npm run build:server",
  "build:client": "...",
  "build:server": "...",
  "start": "node dist/main.js",
  "start:web": "APP_ROLE=web node dist/main.js",
  "start:worker": "APP_ROLE=worker node dist/main.js",
  "start:migrate": "APP_ROLE=migrate node dist/main.js",
  "lint": "...",
  "format": "...",
  "format:check": "...",
  "typecheck": "...",
  "test": "...",
  "test:unit": "...",
  "test:integration": "...",
  "test:e2e": "...",
  "prisma:generate": "prisma generate",
  "prisma:migrate:dev": "prisma migrate dev",
  "prisma:migrate:deploy": "prisma migrate deploy",
  "db:seed": "prisma db seed",
  "db:up": "docker compose up -d postgres",
  "docker:build": "docker build -t homix-marketing:local .",
  "infra:lint": "az bicep build --file infra/main.bicep"
}
```

使用 cross-platform env helper（如 `cross-env`），不要在 npm script 中假设只有 Unix shell；Azure scripts可单独用 Bash。


---
# 22. Docker Image 与运行时行为

## 22.1 单一镜像，多种角色

使用一个生产镜像，通过 `APP_ROLE` 分别运行 Web、Worker 和 Migration。不要维护三套 Dockerfile，也不要在 Worker 镜像中删除前端 build artifact；同一 digest 必须可被三种角色复用。

生产 Dockerfile 使用 multi-stage build，原则如下：

1. 基于官方 Node.js 22 Debian slim 镜像，不使用开发机归档的 `node_modules`。
2. dependency stage 执行干净的 `npm ci`。
3. build stage 执行：
   - Prisma Client generation
   - React/Vite client build
   - TypeScript server build
4. runtime stage 只包含 production dependencies、Prisma engine、编译结果和必要 static assets。
5. 以 non-root user 运行。
6. 设置 `NODE_ENV=production`。
7. 不把 `.env`、SQLite DB、Git metadata、测试 fixture、上传文件或 secret 拷贝进镜像。
8. 提供 `.dockerignore`，至少忽略：

```text
.git
.github
node_modules
dist
coverage
playwright-report
test-results
.env
.env.*
!.env.example
data
*.db
*.sqlite
*.sqlite3
.DS_Store
```

## 22.2 Production build output

推荐输出：

```text
dist/
├── server/
│   └── main.js
└── client/
    ├── index.html
    └── assets/
```

Express 在 Web role 中：

- `/api/*`、`/health/*`、public unsubscribe/webhook routes 由 API 处理。
- 其他非文件 path fallback 到 `dist/client/index.html`。
- static assets 设置长期 cache；HTML 不设置长期 immutable cache。
- API 404 返回 JSON，不 fallback 到 React HTML。

## 22.3 Health endpoints

### `GET /health/live`

仅表示进程活着：

```json
{
  "status": "ok",
  "role": "web",
  "version": "2.0.0",
  "commitSha": "..."
}
```

不得依赖数据库；否则短暂 DB outage 会触发容器重启风暴。

### `GET /health/ready`

Web readiness 检查：

- PostgreSQL 可执行快速 `SELECT 1`
- Prisma migrations 状态符合预期
- 必要配置已加载
- storage adapter 初始化成功

Worker readiness 不需要外部 ingress；worker 自身每 60 秒更新 heartbeat。若实现内部 health server，只允许 internal ingress 或 localhost。

Readiness 响应不得暴露 connection string、secret、数据库 hostname 等敏感值。

## 22.4 Graceful shutdown

收到 `SIGTERM` / `SIGINT`：

### Web

1. 停止接收新连接。
2. 等待进行中的请求，最多 25 秒。
3. 关闭数据库连接与 telemetry provider。
4. 正常退出。

### Worker

1. 停止 claim 新 job/recipient。
2. 当前 Resend request 若已发出，等待它返回或到达明确 timeout。
3. 已 claim 但尚未调用 provider 的记录安全释放 lock。
4. 不得在 outcome uncertain 时把 recipient 重置为普通 `QUEUED`。
5. 最多 25 秒后退出，由 stale-lock recovery 处理剩余状态。

## 22.5 Ephemeral filesystem rule

Azure Container Apps 本地文件系统视为 ephemeral：

- 生产上传必须写 Azure Blob。
- 不依赖本地文件持久保存导入 CSV、图片、导出或数据库。
- 临时文件使用 OS temp directory，并在 request/job 结束时清理。
- 大 CSV 使用 stream parser，不把整个文件读入内存。

---

# 23. Azure Infrastructure as Code

## 23.1 Azure 目标资源

`infra/main.bicep` 至少创建或引用以下资源：

| Resource | 建议名称模式 | 用途 |
|---|---|---|
| Resource Group | 外部创建或 deployment subscription scope | 环境边界 |
| Log Analytics Workspace | `log-homix-mkt-{env}` | Container Apps logs |
| Application Insights | `appi-homix-mkt-{env}` | traces/metrics/errors |
| User Assigned Managed Identity | `id-homix-mkt-{env}` | Key Vault、Blob、ACR access |
| Azure Container Registry | `acrhomixmkt{unique}` | Docker images |
| Storage Account | `sthomixmkt{unique}` | marketing assets |
| Key Vault | `kv-homix-mkt-{unique}` | application secrets |
| VNet | `vnet-homix-mkt-{env}` | app/database network |
| Container Apps Environment | `cae-homix-mkt-{env}` | Web/Worker/Job environment |
| PostgreSQL Flexible Server | `psql-homix-mkt-{unique}` | production data |
| PostgreSQL Database | `homix_marketing` | application database |
| Container App | `ca-homix-mkt-web-{env}` | admin + public endpoints |
| Container App | `ca-homix-mkt-worker-{env}` | durable worker |
| Container Apps Job | `caj-homix-mkt-migrate-{env}` | Prisma deploy migrations |
| Action Group | `ag-homix-mkt-{env}` | operational alerts |

Azure resource names必须经过长度和字符限制处理；不要直接拼接过长 GitHub repository name。

## 23.2 Environments

至少支持：

- `dev`
- `prod`

每个环境使用独立 resource group、PostgreSQL、Key Vault、Storage、Container Apps Environment 和 Resend secret。禁止 dev 与 prod 共用数据库或 suppression table。

参数：

```bicep
@allowed([
  'dev'
  'prod'
])
param environmentName string

@allowed([
  'starter'
  'production'
])
param deploymentTier string = 'starter'

param location string = 'eastus2'
param baseName string = 'homix-mkt'
param imageTag string
param alertEmail string = ''
param customWebDomain string = 'marketing.homixny.com'
param enableZoneRedundantHa bool = false
param webMinReplicas int = 1
param webMaxReplicas int = 3
param workerMinReplicas int = 1
param workerMaxReplicas int = 1
```

`prod` 不代表自动启用昂贵 SKU；SKU 和 HA 必须通过参数显式控制。提供 `starter` 与 `production` parameter example：

### Starter

- PostgreSQL Burstable small SKU
- no HA
- web 1–2 replicas
- worker 1 replica
- 适合当前低量使用，但文档明确这不是高可用配置

### Production

- PostgreSQL General Purpose SKU
- 可选 zone-redundant HA
- web 1–3 replicas
- worker 起始仍为 1；确认并发测试后再扩
- 更长 backup retention

不要硬编码昂贵生产规格；在 `docs/AZURE_DEPLOYMENT.md` 解释成本/可靠性权衡。

## 23.3 Network

生产目标采用 VNet-injected Container Apps Environment 与 private PostgreSQL：

```text
10.40.0.0/16  VNet
├── 10.40.0.0/23  Container Apps infrastructure subnet
└── 10.40.4.0/24  PostgreSQL delegated subnet
```

要求：

- subnet CIDR 通过 parameter 可覆盖。
- Container Apps subnet 按所选 environment/workload profile 的当前 Azure 最低要求保留足够地址；默认 `/23`。
- PostgreSQL subnet 委派给当前 Azure PostgreSQL Flexible Server 所需 service delegation。
- 创建符合 Flexible Server private access 规则的 private DNS zone，并链接 VNet。
- Web 仍有 external HTTPS ingress；仅数据库是 private。
- Worker 和 migration job 无 external ingress。
- 所有数据库连接要求 TLS。

若某 Azure tenant policy 或所选 Container Apps API version 使 private networking 无法一次完成，Codex不得静默退化为对全互联网开放的 PostgreSQL。应：

1. 保留 secure private-network Bicep 为目标；
2. 在 deployment guide 记录精确 blocker；
3. 可额外提供 `allowPublicDatabaseForDev`，默认 `false`，仅 dev 可显式开启；
4. prod 参数禁止 `allowPublicDatabaseForDev=true`。

## 23.4 PostgreSQL

Bicep 配置：

- PostgreSQL supported current stable major version
- database `homix_marketing`
- TLS required
- backup retention parameterized；starter 默认 7 天，production 推荐 14–35 天
- geo-redundant backup 默认关闭，作为参数选项
- HA 仅在 compatible General Purpose / Memory Optimized SKU 上允许
- maintenance window 可参数化或使用 platform default
- server tags：application、environment、owner、managedBy

数据库 admin password：

- 不允许由 `uniqueString()` 等可预测函数生成。
- `scripts/provision-azure.sh` 在本地安全生成随机值，作为 secure deployment parameter 传入，并写入 Key Vault。
- GitHub Actions 情况下，首次 bootstrap 可从 protected GitHub Environment secret 读取；完成后应用只从 Key Vault reference 使用。
- 文档包含 rotate password 操作；不得输出 password 到 console。

应用连接 string 使用 PostgreSQL pool-friendly 设置，并明确：

- Web 与 Worker 各自有限连接池。
- 小 SKU 时总 connection limit 要受控。
- Prisma direct URL 仅 migration job 使用；runtime 不得使用 migration admin 权限账户（若本次实现两账户过于复杂，至少在文档中列出后续 hardening，并确保所有凭据在 Key Vault）。

## 23.5 Storage

创建至少两个 blob containers：

### `marketing-assets`

- 只存公开 listing marketing image / brochure。
- 允许匿名 read 或通过适当 public delivery layer 提供稳定 HTTPS URL。
- 应用身份具有 Blob Data Contributor。
- 禁止上传包含客户名单、内部 CSV、secret 或 PII。
- filename 使用 UUID/content hash，不使用原始地址或邮箱作为 key。
- response headers：正确 MIME、`nosniff`、image long cache。

### `private-exports`

- private access。
- 如实现大 export，写入这里并生成短期 SAS；小 export 可直接 stream response。
- 不把 SAS token写日志。

如果组织 policy 禁止 anonymous blob：

- 提供文档化的 Front Door/CDN 或 public asset proxy 替代方案；
- 邮件里的图片 URL 必须无需 Homix 登录即可读取；
- 不使用短期 SAS 作为长期邮件图片 URL，因为邮件可能数月后仍被打开。

## 23.6 Key Vault

至少创建/引用 secrets：

```text
postgres-admin-password
postgres-runtime-url
postgres-direct-url
resend-api-key
resend-webhook-secret
entra-client-secret   # 仅选择 client-secret 模式时；优先无 secret/OIDC 配置
```

Container App secrets使用 Key Vault references，不把 value复制进 Bicep source。User-assigned identity授予最小必要角色：

- Key Vault Secrets User
- Storage Blob Data Contributor
- AcrPull

GitHub deployment identity：

- Resource Group Contributor 或更细粒度部署权限
- AcrPush
- 不应获得读取应用运行时 secret 的长期权限，除非 bootstrap 流程确实需要

Key Vault：

- RBAC authorization
- soft delete
- purge protection 在 prod 开启
- diagnostic settings 接 Log Analytics

## 23.7 Container Apps configuration

### Web

- external ingress, HTTPS only
- target port 3000
- custom domain later绑定 `marketing.homixny.com`
- min replicas 1
- readiness/liveness probes
- `APP_ROLE=web`
- environment variables使用 non-secret values；secret refs仅用于敏感值
- user-assigned identity
- revision mode `Single`，简化数据库迁移和 rollback

### Worker

- ingress disabled
- min/max initially 1
- `APP_ROLE=worker`
- 相同 image digest
- CPU/memory 可独立于 Web 参数化
- 不使用 HTTP traffic scale rule；PostgreSQL polling worker保持至少 1 replica

### Migration Job

- manual trigger
- timeout 足够 Prisma migration
- retry limit 0 或 1；migration失败不得无限重跑
- `APP_ROLE=migrate`
- 使用 direct database URL
- 每次 release先运行并确认成功，再切换 Web/Worker image

## 23.8 Resource tags

所有支持 tags 的资源：

```text
application=homix-marketing
environment=dev|prod
owner=homix-group
managedBy=bicep
dataClassification=internal
```

公开 marketing asset storage 可标记 `dataClassification=public-marketing-assets`。

## 23.9 Bicep outputs

至少输出：

- ACR login server
- Web Container App FQDN
- Web app name
- Worker app name
- Migration job name
- Container Apps Environment name
- Key Vault name
- Storage account URL
- PostgreSQL server FQDN（输出 hostname可接受，绝不输出 credential）
- managed identity client/resource IDs
- Application Insights connection string 作为 secure output 或直接写入 app env，不在普通 CLI log显示

## 23.10 IaC validation

CI 必须执行：

```bash
az bicep build --file infra/bootstrap.bicep
az bicep build --file infra/main.bicep
```

若 CI 有 Azure权限，增加 `what-if`；PR 不自动 apply production。

## 23.11 Bootstrap 与 provision script

`infra/bootstrap.bicep` 使用 subscription scope，创建或引用：

- target resource group
- ACR（使首次image build有目标）
- 可选deployment identity基础资源

`infra/main.bicep` 使用 resource-group scope创建其余运行资源并接收 immutable `containerImage`。

实现 `scripts/provision-azure.sh`，要求幂等、`set -euo pipefail`，流程：

1. 校验 `az`、subscription、Bicep、Git SHA。
2. subscription-scope部署bootstrap。
3. 生成或安全读取PostgreSQL password；不得打印。
4. 使用 `az acr build` 或本地Docker push构建SHA image。
5. resource-group-scope部署main Bicep，初始 `EMAIL_DELIVERY_MODE=disabled`。
6. 更新并运行migration job，等待成功。
7. 验证Web readiness与Worker heartbeat。
8. 输出non-secret resource names、FQDN以及尚需完成的Entra/Resend/DNS步骤。

Canonical interface：

```bash
./scripts/provision-azure.sh \
  --environment dev \
  --location eastus2 \
  --resource-group rg-homix-mkt-dev-eastus2 \
  --parameters-file infra/dev.local.bicepparam
```

真实local parameter file必须被`.gitignore`。Resend key未提供时，不创建伪造secret；disabled mode仍应可部署，之后通过Key Vault和新的Container App revision完成配置。

## 23.12 `azure.yaml`

提供Azure Developer CLI metadata，指向Bicep provider与Web/Worker services。若`azd`对同一image的多Container App/Job编排有限制，canonical deployment仍以Bicep + scripts + GitHub Actions为准；`azure.yaml`和文档必须明确这一点，不能提供看似可用但实际漏掉Worker或migration的配置。

---

# 24. Azure Authentication 与公开路由部署

## 24.1 Entra ID / Easy Auth

Azure Container Apps Web启用 Microsoft Entra authentication。平台层默认要求认证，并通过 `excludedPaths` 只放行 Webhook、unsubscribe、health 等明确公共路径；应用层仍必须对 `/api/v2/*` 执行身份解析与 RBAC，形成双重保护。浏览器访问管理后台时可重定向到 Microsoft login；公共路径不得触发登录。

管理 API 与 SPA bootstrap：

- 解析 Azure注入的已验证 principal headers。
- 映射 Entra email / object ID 到 `users`。
- 对 `/api/v2/*` 默认 require authenticated principal。
- 再执行应用 RBAC。
- 不接受客户端自己伪造的 `X-MS-*` header；本地模式与 Azure模式严格分离。

Public allowlist 仅包括：

```text
GET  /health/live
GET  /health/ready
POST /api/public/webhooks/resend
GET  /unsubscribe
POST /api/public/unsubscribe/confirm
POST /api/public/unsubscribe/one-click
GET  /public/assets/*          # 仅 local development adapter时
```

如提供 public subscription form，必须单独列出并实施 rate limit、double opt-in；本 listing marketing MVP不默认公开订阅入口。

## 24.2 `configure-entra.sh`

脚本尽量幂等，完成或打印人工步骤：

- 创建/复用 app registration
- 设置 redirect URI
- 创建 service principal
- 输出 non-secret client ID、tenant ID
- 配置 Container App auth settings所需参数
- 不自动授予超出必要范围的 Microsoft Graph权限

Tenant权限不足时，脚本应停止并打印明确手动步骤，不得创建本地共享密码作为生产替代。

## 24.3 Bootstrap user

第一次成功登录：

- 只有 email在 `BOOTSTRAP_ADMIN_EMAILS` 中才自动创建 ADMIN。
- 其他用户若 `AUTO_PROVISION_USERS=false`，返回 access denied，并记录 audit/security event。
- `AUTO_PROVISION_USERS=true` 时只允许 `ALLOWED_EMAIL_DOMAINS`，默认角色 VIEWER。
- Admin之后可在 UI 修改应用角色。

---

# 25. Custom Domains、DNS 与 TLS

## 25.1 管理后台域名

目标：

```text
marketing.homixny.com
```

提供 `scripts/configure-custom-domain.sh`：

1. 读取 Bicep output 中 Web FQDN。
2. 打印需要创建的 DNS validation / CNAME records。
3. 验证 DNS resolution。
4. 绑定 Container Apps custom domain。
5. 申请并绑定 Azure managed certificate；若当前订阅/域名情形不支持，文档给出 certificate upload fallback。
6. 最终 HTTPS smoke test。

DNS 未完成时，系统仍可通过 Azure-generated FQDN运行，但 `BASE_URL` 与 unsubscribe链接在 live send前必须改为最终稳定域名。

## 25.2 营销发件域名

目标：

```text
listings.homixny.com
```

在 Resend Dashboard创建 domain，由 Resend给出实际 SPF、DKIM 等 DNS records。不要在代码或 Bicep中猜测 selector/value。

建议 tracking domain：

```text
links.listings.homixny.com
```

只在 Resend实际配置并验证后启用。

明确区分：

- `marketing.homixny.com`：Azure后台与 public unsubscribe URL
- `listings.homixny.com`：From domain
- `links.listings.homixny.com`：可选 click/open tracking domain

不要把 Azure Container App custom domain设置成发件域名，也不要让 DNS 记录互相覆盖。

## 25.3 DMARC

上线前检查组织域与营销子域的 DMARC策略。系统文档应建议先观察再逐步强化，具体 record由 Homix DNS管理员根据当前公司邮件体系决定，不能盲目覆盖已有 `_dmarc.homixny.com`。

Live readiness 页面记录人工确认项：

- Resend domain verified
- SPF verified
- DKIM verified
- DMARC reviewed
- tracking domain verified or tracking explicitly disabled
- Reply-To mailbox tested
- company postal address configured

系统无需直接修改 DNS，但必须阻止未确认 sender profile用于 live send。

---

# 26. GitHub Actions 与 CI/CD

## 26.1 Workflows

创建或重写：

```text
.github/workflows/ci.yml
.github/workflows/deploy-dev.yml
.github/workflows/deploy-prod.yml
.github/workflows/security.yml
```

## 26.1.1 Security workflow

`security.yml` 至少执行：

- dependency audit（高/严重漏洞阻断，允许有期限的书面exception）
- secret scanning of tracked files/build context
- container image vulnerability scan
- CodeQL或等价TypeScript static analysis
- license report，阻止明确不兼容的依赖许可证

扫描不得把测试fixture中的假key误当真实secret而长期关闭规则；应使用明确fixture pattern或最小scope ignore。

## 26.2 CI workflow

PR 与 push 执行：

```text
checkout
setup Node 22 with npm cache
npm ci
prisma generate
format:check
lint
typecheck
unit tests
PostgreSQL integration tests
client build
server build
Docker build
Bicep build
OpenAPI validation
Playwright smoke test
```

CI 必须使用 Linux，从而避免旧 ZIP 中 macOS native `better-sqlite3` binary一类问题。不得缓存整个 `node_modules`；只缓存 npm package cache。

CI 绝不调用真实 Resend send endpoint。使用 fake provider或 mock server，并设置：

```text
EMAIL_DELIVERY_MODE=disabled
```

## 26.3 Azure OIDC

GitHub Actions使用 Azure federated identity / OIDC，不保存长期 Azure client secret。

Protected GitHub Environment variables/secrets建议：

```text
AZURE_CLIENT_ID
AZURE_TENANT_ID
AZURE_SUBSCRIPTION_ID
AZURE_RESOURCE_GROUP
AZURE_LOCATION
AZURE_ENVIRONMENT_NAME
AZURE_ACR_NAME
```

首次 bootstrap步骤在 `docs/AZURE_DEPLOYMENT.md` 说明。Production environment启用 required reviewers。

## 26.4 Image versioning

每次 build push：

```text
{acr}/homix-marketing:{git-sha}
{acr}/homix-marketing:2.0.0-{run-number}
```

不得仅依赖 `latest`。Bicep/CLI部署使用 immutable SHA tag；release output记录 image digest。

## 26.5 Deployment sequence

严格顺序：

1. CI通过。
2. Build并 push image。
3. Deploy/update基础设施和 migration job definition，但不要先把新 image切给 production Web/Worker。
4. 用新 image运行 migration job。
5. 等待 migration execution成功；失败立即停止。
6. 更新 Web image。
7. 等待 readiness成功。
8. 更新 Worker image。
9. 等待 worker heartbeat。
10. 执行 authenticated smoke tests与 public endpoint tests。
11. 记录 deployment summary。

若 schema变更不向后兼容，Codex应优先设计 expand/migrate/contract migration，避免旧 Worker与新 DB短暂并存时崩溃。

## 26.6 Production deployment controls

`deploy-prod.yml`：

- 仅 `workflow_dispatch` 或 version tag触发。
- 使用 GitHub `production` Environment required approval。
- 输入 `imageTag`，默认当前 commit SHA。
- 在 apply前运行 Bicep what-if并保存 artifact。
- 迁移失败不得继续。
- smoke test失败标红并打印 rollback command。

## 26.7 Rollback

应用 rollback：

- 使用前一成功 image tag更新 Web与Worker。
- 不自动 rollback数据库 migration。
- 所有 migration应尽量 forward-compatible；破坏性 column/table删除延迟到后续 release。
- `docs/OPERATIONS_RUNBOOK.md` 包含查找前一 revision/image digest、执行 rollback、验证 heartbeat的方法。

---

# 27. 测试规格

Codex必须实现测试，不得仅把以下内容写入 README。

## 27.1 Unit tests

至少覆盖：

### Email / contact normalization

- trim/lowercase
- Unicode name不被破坏
- 不删除 plus addressing
- invalid email拒绝

### Audience DSL

- AND/OR group
- include/exclude tags
- market/property interest
- status与suppression默认过滤
- deterministic query compilation
- 不允许 arbitrary SQL field/operator

### Campaign state machine

- 合法 transition
- 非法 transition返回 domain error
- send后 content不可编辑
- cancel/pause/resume规则

### Template rendering

- HTML/text均生成
- XSS sanitizer
- required listing fields
- unsubscribe link
- postal address
- preheader
- currency/area formatting

### Suppression priority

- complaint、unsubscribe、hard bounce、manual等规则
- contact重新导入不复活 suppression
- manual unsuppress authorization

### Quota calculation

- local date in America/New_York
- DST transition
- warm-up limit
- sender daily limit
- reservations/release
- zero remaining quota

### Retry classifier

- 4xx/5xx provider response分类
- timeout before request与 uncertain outcome区别
- max attempts
- exponential backoff + jitter bounds

### Idempotency key

- same batch same attempt chain稳定
- different batch不同
- deterministic且不含 PII

### Webhook event reduction

- duplicate event ignored
- out-of-order delivered/opened不倒退状态
- complaint creates suppression
- unknown event retained but does not crash

## 27.2 Integration tests with PostgreSQL

使用真实 PostgreSQL测试实例，不用 SQLite替代：

1. Prisma migration from empty DB。
2. Seed idempotency。
3. Concurrent job claim仅一 worker获得同一 job。
4. Concurrent recipient claim无重复。
5. Concurrent quota reservation不超 limit。
6. Campaign snapshot transaction rollback不留下半成品。
7. Suppression race：send前退订阻止 provider call。
8. Duplicate Webhook inbox insert根据 unique key去重。
9. Batch accepted transaction正确更新 recipients、attempt、quota。
10. Temporary failure retry最终 accepted。
11. Uncertain outcome转 manual review，不盲目重发。
12. Cancel campaign不发送尚未 claim recipients。

## 27.3 API tests

使用 Supertest：

- all protected endpoints reject anonymous
- role authorization
- public webhook signature invalid → 400/401
- webhook raw body未被 JSON middleware改变
- one-click unsubscribe content type和响应
- CSV import validation/errors
- upload MIME/size validation
- cursor pagination
- mutation audit log
- idempotency/optimistic concurrency for send action

## 27.4 E2E tests

Playwright本地 auth模式：

1. Admin login。
2. 创建 agent。
3. 创建 sender profile（fake verified）。
4. CSV导入 contacts并查看结果。
5. 创建 listing并上传测试图片。
6. 创建 saved audience并 preview count。
7. 创建 campaign、选择 template、preview desktop/mobile。
8. test send走 fake provider。
9. schedule/send，worker处理。
10. 注入 fake webhook事件。
11. 查看 campaign analytics和recipient detail。
12. 点击 public unsubscribe并确认后续 campaign排除。

## 27.5 Security tests

- rich text XSS payload
- SVG upload rejection or strict sanitization policy
- path traversal filename
- CSV formula injection in export
- forged Azure principal headers in local/prod mode
- unauthorized unsuppress
- webhook replay
- oversized body/upload
- rate limit public endpoints
- open redirect in return URL

## 27.6 Test provider

实现 `FakeEmailProvider`：

- 记录 outbound payload到 test DB/in-memory sink
- 可配置 accepted、temporary failure、permanent failure、timeout uncertain
- 生成 deterministic provider IDs
- 不访问网络
- 支持 batch max size与部分结果模拟

生产代码通过 interface注入 provider，不允许在业务层到处直接 new Resend client。

## 27.7 Coverage and quality gate

- 关键 domain/service模块 branch coverage目标至少 80%。
- 不以追求总 coverage数字为由给 generated code或 trivial UI写无价值测试。
- CI任何 lint/type/test/build/Bicep失败即失败。
- 不允许 `test.skip`、`describe.skip` 或永久 quarantine关键用例。

---

# 28. Legacy SQLite V1 数据迁移

## 28.1 CLI

实现：

```bash
npm run migrate:v1 -- \
  --sqlite /absolute/path/to/email_service.db \
  --dry-run \
  --report ./migration-report.json
```

正式执行：

```bash
npm run migrate:v1 -- \
  --sqlite /absolute/path/to/email_service.db \
  --apply \
  --report ./migration-report.json
```

要求：

- 默认 dry-run；必须显式 `--apply` 才写 PostgreSQL。
- 读取 legacy DB只读。
- 可重复运行，不创建重复 contacts/tags/suppressions/import records。
- 输出 count、skipped、invalid、conflicts、warnings。
- 不输出完整联系人名单到 console。
- 迁移 transaction按合理 chunk执行，避免一个坏 row使全部数据不可诊断。

## 28.2 Mapping

### Legacy subscribers → contacts

- normalize email
- name尽量拆 first/last；无法可靠拆分时保留在 `displayName`/notes兼容字段，不猜测
- legacy status映射 contact status与 suppression
- created/updated timestamps尽可能保留
- source=`LEGACY_EMAIL_SERVICE`

### Legacy tags → tags/contact_tags

- 按 normalized name dedupe
- 保留 display name

### Legacy unsubscribe/bounce/complaint/suppressed

必须创建独立 `suppressions`：

- `unsubscribed` → `UNSUBSCRIBE`
- `complained` → `COMPLAINT`
- `bounced` 若无法判断 soft/hard，保守映射为 `LEGACY_BOUNCE_REVIEW`，默认 suppress并标记需Admin review
- `suppressed` → `PROVIDER_SUPPRESSED`

不得因为 contact之后重新导入而删除。

### Legacy campaigns

旧 campaign导入为：

- `type=LEGACY_ARCHIVE`
- `status=ARCHIVED`
- 只读
- 不允许 duplicate后直接 live send，除非用户重新选择 listing、sender、audience并通过新系统validation

### Legacy send logs/events

- 可迁移为历史 audit/legacy delivery events。
- 不将旧 send log当作新 recipient snapshot。
- provider ID、timestamps可用则保留。
- 不完整数据写 migration warning。

## 28.3 Asset migration

- 只迁移实际被 legacy campaign引用且文件存在的 marketing assets。
- 通过 storage adapter上传。
- 计算 checksum，避免重复。
- 缺失文件不阻断 contacts/suppressions迁移。
- 迁移报告列出 missing asset count。

## 28.4 Cutover steps

1. 旧系统切换 read-only / stop sending。
2. 备份 SQLite与旧 uploads。
3. 新系统 prod保持 `EMAIL_DELIVERY_MODE=disabled`。
4. 执行 migration dry-run并review report。
5. 执行 apply。
6. 对 counts与 suppression抽样核对。
7. 测试登录、listing、campaign、unsubscribe。
8. 仅 sandbox allowlist mode测试。
9. 完成 DNS/Resend/live checklist后再启用 live。
10. 旧系统至少保留只读备份，不再接受发送任务。

---

# 29. Deliverability 与 Live-Send 安全闸门

## 29.1 Delivery modes

### `disabled`

- 禁止任何外部发送。
- preview、audience、snapshot、fake job可工作。
- 默认 local/dev/首次 prod deployment。

### `sandbox`

- 仅允许 `EMAIL_TEST_ALLOWLIST`。
- 所有 test send地址必须经过 allowlist检查；sandbox campaign recipient也必须经过同一allowlist检查。
- 普通 campaign即使被错误 schedule也不得向非allowlist recipient发送。

### `live`

只有 readiness全部通过才允许：

- company legal/postal address
- verified sender profile
- verified Resend domain
- stable `BASE_URL`
- Webhook最近成功或明确处于首次上线状态
- unsubscribe endpoint公网可访问
- worker heartbeat正常
- DB migrations current
- live confirmation由 ADMIN完成并写 audit log

切换到 live 不应只改前端按钮；后端每次发送仍验证。

## 29.2 Warm-up

Sender profile保存：

- warmup enabled
- warmup start local date
- schedule JSON或标准 preset
- daily limit

默认 warm-up schedule在系统设置中可调整。首次上线可使用保守阶梯，例如从低百封/日开始，并根据真实名单质量、bounce/complaint调整。不要把文档中的示例视为任何域名的保证值。

## 29.3 Reputation isolation

- 仅使用稳定营销子域。
- 不自动生成 `aa.`, `bbb.` 等随机 sender域。
- 不按 recipient随机 From address。
- 公司日常一对一邮箱与营销流量分离，但保持透明、可识别品牌。
- Reply-To可以是 listing agent真实邮箱。

## 29.4 Recipient quality

系统必须保存 source与consent/relationship信息：

- CRM/past client
- website inquiry
- open house/event
- broker relationship
- manual import
- legacy
- unknown

默认 Audience可排除 source unknown。CSV import必须要求用户确认名单来源，不提供“scraped/purchased list optimization”功能。

## 29.5 Complaint / bounce thresholds

System settings提供阈值，超出时：

- campaign可自动 pause remaining recipients
- sender readiness变为 warning/blocked（按阈值级别）
- Dashboard显示 action required
- 通知 Admin/alert channel

默认参考值应保守，且配置说明提醒以 Resend与 mailbox provider当前政策为准。系统不得以“拆到多个子域”作为阈值处置方式。

## 29.6 Tracking

- Open tracking默认可以关闭，因为隐私工具与图片代理会造成误差。
- Click tracking按 sender profile配置。
- UI明确 open并不等于真实阅读。
- 不把 click/open作为合法 consent证据。
- 取消订阅链接不得经过会失效的短链服务。

## 29.7 Content quality

Templates：

- subject准确，不误导
- From name清晰标识 Homix Realty
- 不使用大量大写、重复感叹号、虚假紧迫性
- image有 alt text
- 关键 listing内容即使图片不加载仍可读
- CTA链接指向用户提供的 listing URL
- physical address与unsubscribe可见

---

# 30. Operations Runbook

`docs/OPERATIONS_RUNBOOK.md` 至少覆盖以下流程，包含命令占位符与验证步骤。

## 30.1 Pause all sending

提供两层机制：

1. DB/system setting `GLOBAL_SEND_PAUSED=true`
2. Azure env emergency override或直接 scale worker至0

优先 DB pause，让 worker保持运行并处理 Webhook；仅严重 incident才 scale worker至0。

暂停必须阻止新 provider calls，但允许：

- Webhook ingest/process
- unsubscribe
- admin UI
- reconciliation

## 30.2 Resume sending

- 确认 incident原因
- 检查 quota、sender readiness、manual-review batches
- Admin输入 resume reason
- small canary batch/test
- 恢复正常 worker

## 30.3 Resend API key rotation

1. 创建新 key。
2. 更新 Key Vault secret为新 version。
3. 新 Container Apps revision或secret refresh。
4. test allowlist发送。
5. revoke旧 key。
6. audit记录，不记录 key value。

## 30.4 Webhook secret rotation

支持短暂双 secret验证窗口：

- current secret
- previous secret optional with expiry

或严格维护窗口切换。不得在切换瞬间丢失所有 webhook。

## 30.5 Worker stalled

- 检查 heartbeat、Container App logs、DB locks
- 检查 stale jobs
- 不直接批量重置 uncertain batches
- 运行安全 stale-lock recovery
- restart worker revision
- 验证无 duplicate sends

## 30.6 Provider timeout / uncertain outcome

- 使用相同 idempotency key在允许窗口内安全 retry。
- 若无法确认且idempotency窗口已过，转 `MANUAL_REVIEW`。
- Admin查看 batch payload hash、attempt时间、provider日志/Resend dashboard。
- 不提供“一键全部重发 uncertain”按钮。

## 30.7 Complaint spike

- 立即 pause sender/campaign
- 检查 recipient source、recent import、content、From identity
- 确认 complaint suppressions已生效
- 不解除 complaint suppression
- 仅在原因解决、阈值恢复后由Admin resume

## 30.8 Bounce spike

- 区分 hard/soft/provider temporary
- hard bounce永久 suppress
- soft bounce按policy有限重试
- 检查 CSV source与domain typo
- campaign remaining recipients可暂停

## 30.9 Database backup/restore

- 说明 Azure automatic backup/PITR配置
- 定期恢复演练到隔离 server
- 恢复后先 `EMAIL_DELIVERY_MODE=disabled`
- 不让恢复的历史 queued jobs立即重复发送
- 恢复脚本首先将非终态 campaigns/jobs置为 recovery review，或通过 recovery guard要求Admin确认

这一点必须在实现中考虑：恢复旧数据库快照可能使系统“忘记已经发出的邮件”。因此 prod恢复后默认 global send paused，直到 reconciliation完成。

## 30.10 Blob recovery

- marketing assets是公开内容，但仍配置合理 soft delete/versioning（按成本参数化）
- orphan cleanup有grace period
- 删除 listing不立即物理删除被历史 campaign snapshot引用的图片

## 30.11 Deployment rollback

- 找到上一成功 SHA/digest
- update Web/Worker
- verify readiness/heartbeat
- 不逆向运行 destructive migration
- 保持 send paused直到状态确认

---

# 31. 实施顺序（Codex必须连续完成）

以下是依赖顺序，不是分阶段等待用户确认的里程碑。Codex应持续执行到全部完成。

## Phase 0 — Baseline

1. 阅读现有 README、package、source、tests、Docker、GitHub Actions。
2. 记录现有可复用 behavior。
3. 从干净 dependency install开始；不信任 ZIP内 `node_modules`。
4. 创建 feature branch（若可行）。

## Phase 1 — Repository modernization

1. 更新 package scripts/dependencies。
2. 建立 client/server/shared目录。
3. 引入 ESLint/Prettier/strict TS。
4. 建立 config validation与domain errors。
5. 保持旧系统临时可编译或在明确 commit中整体切换，不留下长期双架构。

## Phase 2 — PostgreSQL foundation

1. 写 Prisma schema/enums/indexes。
2. 初始 migration。
3. seed reference data/default settings。
4. raw SQL transaction helpers for SKIP LOCKED/quota。
5. repository/service tests。

## Phase 3 — Auth/audit/reference data

1. local auth adapter。
2. Azure principal adapter。
3. users/roles。
4. audit middleware/service。
5. agents/tags/markets/property interests/sender profiles。

## Phase 4 — Contacts/import/suppression/audiences

1. contacts CRUD。
2. streaming CSV import。
3. dedupe与field mapping。
4. global suppressions。
5. Audience DSL、preview、saved audiences。
6. tests。

## Phase 5 — Listings/assets

1. listing model/API。
2. local/Azure storage adapters。
3. image processing与validation。
4. PDF brochure support。
5. listing UI。

## Phase 6 — Campaign/domain/template

1. React Email templates。
2. campaign state machine/wizard。
3. content snapshot。
4. recipient snapshot transaction。
5. preview/test send。
6. sender readiness。

## Phase 7 — Worker/delivery

1. durable jobs。
2. quota reservation。
3. recipient claim。
4. Resend provider adapter。
5. batch/idempotency/retry/manual review。
6. pause/resume/cancel/completion。
7. worker integration tests。

## Phase 8 — Webhook/unsubscribe/analytics

1. raw-body webhook route。
2. inbox/dedupe/processor。
3. suppression side effects。
4. visible + one-click unsubscribe。
5. metrics/recipient drill-down/export。

## Phase 9 — React Admin

1. shell/navigation/auth bootstrap。
2. all required screens。
3. loading/error/empty states。
4. UX safety confirmations。
5. accessibility smoke checks。

## Phase 10 — Azure/CI/CD

1. production Dockerfile。
2. Bicep modules。
3. provisioning/auth/custom domain scripts。
4. GitHub OIDC workflows。
5. migration job/deployment sequence。
6. monitoring/alerts。

## Phase 11 — Migration/docs/final verification

1. SQLite migration CLI。
2. deployment/security/operations/API/data model docs。
3. OpenAPI spec。
4. full test/build/docker/Bicep suite。
5. final gap scan：TODO、SQLite runtime、hard-coded secrets、disabled tests、dead routes。

---

# 32. 验收场景

所有场景应能在 local fake-provider环境自动化或手动复现；涉及真实 Azure/Resend的步骤在 deployment runbook中验证。

## AC-01 Authentication

- 未登录访问Admin route被拒绝或进入Entra login。
- Homix允许用户进入。
- 非允许域用户不被自动 provision。
- VIEWER不能 mutation。

## AC-02 Contact import

导入包含：

- valid rows
- uppercase/space emails
- duplicate emails
- invalid email
- formula-like cells
- already unsubscribed email

结果：

- normalize/dedupe正确
- invalid report可下载
- suppression地址仍不可发送
- audit log完整

## AC-03 Listing

- 创建 commercial listing。
- 上传 JPG/PNG/WebP和PDF。
- 非法 executable/SVG按policy拒绝。
- 选择 hero image。
- archive listing不删除历史 campaign content。

## AC-04 Audience

- 组合 market + property interest + tags + exclusions。
- estimate与snapshot count一致，除非在 snapshot前发生可解释的suppression变化。
- sample不泄露给无权限用户。

## AC-05 Campaign readiness

没有 sender verification、company address、listing hero/URL、audience或successful test send时，live send被后端拒绝并返回明确原因。

## AC-06 Snapshot

按下 schedule/send：

- content snapshot冻结
- recipients冻结
- 后续修改contact tag不改变该campaign recipient set
- 后续修改listing不改变已冻结campaign内容

## AC-07 Suppression race

Recipient在snapshot后、实际send前unsubscribe：

- send前recheck发现suppression
- recipient标记SUPPRESSED
- quota释放
- provider没有收到该地址

## AC-08 Daily quota

Sender daily limit 200，已使用/保留190：

- worker最多再claim 10
- 其余等待下一发送日/window
- concurrent workers也不能超过200

## AC-09 Batch idempotency

Resend request返回timeout/连接中断：

- 同一batch retry使用相同idempotency key
- 不生成重复recipient batch
- 超出安全窗口且无法确认时进入MANUAL_REVIEW

## AC-10 Partial/permanent failure

- temporary failure按backoff retry
- invalid recipient/permanent provider failure不无限重试
- failure status与reason可在recipient detail查看

## AC-11 Webhook

对同一event发送两次：

- inbox只有一个logical event
- counters不重复增加

先发送opened再delivered：

- event均保留
- recipient汇总状态不倒退

complaint：

- global suppression创建
- contact重导入仍不可发送

## AC-12 Unsubscribe

- visible unsubscribe页面成功
- RFC one-click POST成功
- token invalid/expired policy明确
- 多次请求幂等
- 已排队但未send recipient被阻止
- 响应不要求登录

## AC-13 Pause/resume/cancel

- pause后不发新batch，in-flight安全完成
- resume继续未发送recipient
- cancel不发送未claim recipient
- delivered/history保留

## AC-14 Analytics

Dashboard与campaign detail能显示：

- snapshot total
- eligible/suppressed
- accepted/delivered/opened/clicked
- bounced/complained/failed/manual review
- rates denominator定义一致
- recipient event timeline

## AC-15 Azure image

- 同一image可用 `APP_ROLE=web|worker|migrate`
- Web/Worker独立运行
- filesystem重启不丢assets/data
- Key Vault secret未出现在image或logs

## AC-16 CI/CD

- PR checks完整通过
- production deploy有approval
- migration失败阻断release
- image以SHA标记
- smoke test和rollback instruction存在

## AC-17 Legacy migration

- dry-run不改目标DB
- apply可重复
- unsubscribed/complained记录迁移到global suppression
- legacy campaign只读归档
- migration report不泄露完整PII

## AC-18 Disaster recovery guard

从旧数据库时间点恢复后：

- 系统默认暂停外发或检测到recovery guard
- 不会立即把历史queued recipients重复发送
- Admin完成reconciliation后才能恢复

---

# 33. Definition of Done

只有全部满足才算完成：

## Application

- [ ] React admin完成所有MVP页面。
- [ ] Express API按OpenAPI实现。
- [ ] PostgreSQL/Prisma替代production SQLite。
- [ ] Contacts、Listings、Audiences、Campaigns、Analytics完整。
- [ ] Sender profile与Reply-To per campaign。
- [ ] recipient/content snapshot。
- [ ] global suppression。
- [ ] true quota reservation。
- [ ] durable jobs和safe retry。
- [ ] Resend batch idempotency。
- [ ] raw Webhook inbox/dedupe。
- [ ] one-click unsubscribe。
- [ ] audit log和RBAC。

## Azure

- [ ] production Docker multi-stage/non-root。
- [ ] Web、Worker、Migration role可运行。
- [ ] Bicep创建所需资源。
- [ ] Managed Identity + Key Vault references。
- [ ] PostgreSQL private network target。
- [ ] Blob adapter。
- [ ] Entra auth配置/脚本。
- [ ] custom domain脚本。
- [ ] GitHub Actions OIDC。
- [ ] monitoring与runbook。

## Quality

- [ ] `npm ci` on clean Linux。
- [ ] format check通过。
- [ ] lint通过。
- [ ] typecheck通过。
- [ ] unit tests通过。
- [ ] integration tests通过。
- [ ] e2e tests通过。
- [ ] client/server build通过。
- [ ] Docker build通过。
- [ ] Bicep build通过。
- [ ] OpenAPI validation通过。
- [ ] 无关键 skipped tests。

## Security / compliance

- [ ] Git history/current tree无真实secret。
- [ ] no public PostgreSQL fallback in prod。
- [ ] uploads、XSS、CSV injection验证。
- [ ] logs无secret/recipient dump。
- [ ] public routes最小化。
- [ ] production local auth/bypass被禁止。
- [ ] unsubscribe、postal address、suppression规则有效。

## Documentation

- [ ] README快速启动。
- [ ] `docs/AZURE_DEPLOYMENT.md`。
- [ ] `docs/OPERATIONS_RUNBOOK.md`。
- [ ] `docs/DATA_MODEL.md`。
- [ ] `docs/API.md`。
- [ ] `docs/SECURITY.md`。
- [ ] `docs/MIGRATION.md`。
- [ ] `.env.example`完整。
- [ ] 真实外部值清单完整。

---

# 34. 禁止的捷径

以下任一项都不算完成：

- 只生成页面mockup，没有后端/DB/worker。
- 只改README或输出计划。
- 保留SQLite作为Azure生产DB。
- Web request内同步发送整个campaign。
- 用 `setTimeout`/内存queue作为durable scheduler。
- 每个chunk重新计算动态audience。
- 只用 `send_logs exists`防重复。
- 遇到provider timeout无脑创建新batch重发。
- 使用随机子域/From轮换规避reputation。
- 把Resend key写进GitHub workflow或Bicep plain text。
- Container App本地目录保存production assets。
- 用一个共享API password代替Entra生产登录。
- 仅在前端检查权限、send readiness或quota。
- 在tests中调用真实Resend。
- 留下“TODO: implement later”关键功能。
- 把编译失败解释成环境问题而不修复项目。
- 声称已经部署Azure但实际没有Azure执行结果。

---

# 35. Codex最终输出格式

Codex完成代码后，最终回复必须包含：

## 1. Implemented

按模块列出实际完成的内容，不重复粘贴本规范。

## 2. Architecture decisions

列出与规范一致的重要实现选择；若有偏差，说明原因、影响与替代保障。

## 3. Verification

逐条给出实际执行命令和结果，例如：

```text
npm run format:check  PASS
npm run lint          PASS
npm run typecheck     PASS
npm test              PASS
npm run build         PASS
docker build ...      PASS
az bicep build ...    PASS
```

未执行/失败必须如实说明，不能写成PASS。

## 4. Azure deployment

给出从bootstrap到prod deploy的准确命令顺序和文件位置。

## 5. Required external values

只列出仍需Homix提供的值：

- Azure subscription/tenant/environment identifiers
- GitHub Azure OIDC setup identifiers
- Resend API key
- Resend Webhook secret
- DNS records/domain verification
- Entra allowed users/admin emails
- company postal address
- alert email
- desired Azure SKU/HA choice
- logo/brand assets（如有）

不要把这些未提供值当作代码未完成的理由。

## 6. Migration/cutover

给出旧SQLite dry-run、apply和live-send enable步骤。

## 7. Known limitations

只列出真实存在且不违反本规范核心验收的限制。

---

# 36. 部署前由 Homix 填写的最终清单

```text
Azure subscription ID:                 REQUIRED_VALUE
Azure tenant ID:                       REQUIRED_VALUE
Azure target region:                   eastus2 (confirm)
Azure resource group dev:              REQUIRED_VALUE
Azure resource group prod:             REQUIRED_VALUE
GitHub repository/environment:         REQUIRED_VALUE
Bootstrap admin emails:                REQUIRED_VALUE
Allowed employee email domains:        homixny.com (confirm)
Admin web domain:                      marketing.homixny.com (confirm)
Resend sending domain:                 listings.homixny.com (confirm)
Default From:                          Homix Realty <listings@listings.homixny.com>
Default Reply-To:                      REQUIRED_VALUE
Company legal/postal address:          REQUIRED_VALUE
Resend API key:                        KEY_VAULT_ONLY
Resend webhook secret:                 KEY_VAULT_ONLY
Alert recipient email:                 REQUIRED_VALUE
Deployment tier:                       starter | production
PostgreSQL HA:                         true | false
Open tracking default:                 true | false
Click tracking default:                true | false
Marketing logo/brand assets:           OPTIONAL
```

Live send必须保持disabled，直到清单中的required项与DNS验证完成。

---

# 37. 官方实现参考

实现时优先检查当前官方文档和SDK版本，避免照抄过期博客：

- [Azure Container Apps documentation](https://learn.microsoft.com/azure/container-apps/)
- [Deploy to Azure Container Apps with GitHub Actions](https://learn.microsoft.com/azure/container-apps/github-actions)
- [Azure Container Apps secrets and Key Vault references](https://learn.microsoft.com/azure/container-apps/manage-secrets)
- [Azure Container Apps authentication](https://learn.microsoft.com/azure/container-apps/authentication)
- [Azure Container Apps custom domains and managed certificates](https://learn.microsoft.com/azure/container-apps/custom-domains-managed-certificates)
- [Azure Database for PostgreSQL Flexible Server](https://learn.microsoft.com/azure/postgresql/flexible-server/overview)
- [Azure Blob Storage JavaScript SDK](https://learn.microsoft.com/azure/storage/blobs/storage-blob-upload-javascript)
- [Azure Monitor OpenTelemetry for Node.js](https://learn.microsoft.com/azure/azure-monitor/app/opentelemetry-enable?tabs=nodejs)
- [Resend Batch API](https://resend.com/docs/api-reference/emails/send-batch-emails)
- [Resend Webhooks](https://resend.com/docs/dashboard/webhooks/introduction)
- [Resend idempotency keys](https://resend.com/docs/dashboard/idempotency-keys)
- [Resend domain authentication](https://resend.com/docs/dashboard/domains/introduction)
- [Google email sender guidelines](https://support.google.com/a/answer/81126)
- [FTC CAN-SPAM compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)

版本差异处理原则：

1. 以当前官方API/SDK schema为准。
2. 不因API名称变化而削弱本规范的安全、幂等、审计或架构要求。
3. 若官方服务限制与规范冲突，在代码注释和最终报告中记录，并选择最接近且更安全的实现。

---

# 38. 最后一条执行指令

现在开始在当前仓库完成全部实现。先完整阅读本文件，再检查实际代码；不要只生成另一个计划文档。对缺失的外部secret、DNS和Azure账号使用明确占位符并继续工作。持续运行检查和修复，直到能够提交一套可本地验证、可通过Bicep/GitHub Actions部署到Azure、且默认禁止意外live send的 Homix Marketing Listing V2。
