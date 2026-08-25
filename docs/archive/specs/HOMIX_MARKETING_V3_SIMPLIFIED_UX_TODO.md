# Homix Marketing V3 — 极简 UX / UI 重构 To-Do List

> **归档状态：** 已实施的历史产品规范；保留用于追溯，不再作为当前执行清单。

> **用途：** 将本文件放到当前 Email Service repository 根目录，交给 Codex 连续实施。
>
> **目标：** 保留当前已经验证可用的 BBO → OneKey、AI、Resend、Worker、Webhook、Suppression、Quota、Azure 架构；只重构产品信息架构、日常操作流程和前端视觉，使普通 Homix 用户可以在一个页面内快速完成：
>
> **输入 MLS Number 或地址 → 选择房源 → 选择收件人 → 审核 AI 邮件 → 发测试 → 正式发送。**

---

## 0. 给 Codex 的直接执行指令

完整阅读本文件，然后在**当前 repository 和当前分支**上连续完成全部 P0、P1、测试、文档和验收工作。

不得只输出计划，不得创建新 repository，不得重写已经稳定工作的邮件投递后端。

必须遵守以下规则：

- 保留现有 BBO/OneKey provider，BBO 是 Homix 自己运营的正式 OneKey/MLS Grid 中间层。
- 保留现有 PostgreSQL/Prisma 数据模型，除非本文件明确要求极小的兼容性 migration。
- 保留现有 Campaign snapshot、Worker queue、Resend、Webhook、Suppression、Quota、Retry、Manual Review 和 Azure 架构。
- 普通用户界面不得暴露不必要的技术概念。
- 优先复用现有 API；只有为了把多个内部步骤安全地封装成一个用户动作时，才增加最小 orchestration endpoint。
- 所有新增写操作必须保持权限校验、幂等性、审计记录和并发安全。
- 完成后必须运行本文件要求的全部检查，并返回准确结果；不得在测试失败时声称完成。

---

# 1. 产品北极星

## 1.1 用户真正要完成的事情

用户的任务不是“管理 Campaign 状态机”，而是：

> 我有一个 OneKey 房源，我要快速生成一封合规的推广邮件，选择一批合适的收件人，测试，然后发送。

## 1.2 最终日常流程

```text
Home
  ↓
输入 MLS Number 或地址
  ↓
选择 OneKey 搜索结果
  ↓
系统自动导入/复用 Property，并自动创建草稿
  ↓
系统自动填好默认 Sender、Reply-To、Template、CTA 和 Campaign Name
  ↓
系统自动准备 AI 邮件草稿
  ↓
用户选择/确认 Recipients
  ↓
用户在同一页面审核内容和邮件预览
  ↓
Send test to me
  ↓
Send campaign / Schedule
```

## 1.3 可量化 UX 成功标准

- [ ] 从 Home 开始，用户最多经过 **1 次页面跳转**进入完整 Composer。
- [ ] 输入 MLS 后，完成正式发送最多需要 **5 个主要用户动作**。
- [ ] 不要求用户手工填写 Campaign Name。
- [ ] 不要求用户手工选择默认 Sender。
- [ ] 不要求用户理解或点击 `Mark ready`。
- [ ] 不要求用户理解或点击 `Snapshot & send`。
- [ ] 不要求用户理解 `Allowlisted test`。
- [ ] 不要求用户先去 Listings 页面导入，再去 Audiences 页面创建名单，再回 Campaigns。
- [ ] 所有常用内容在一个 Composer 页面内完成。
- [ ] 用户刷新浏览器后，未发送草稿仍然存在并恢复。
- [ ] UI 中任何时刻最多突出 **一个 Primary CTA**。
- [ ] 新用户不看说明文档，也能在 3 分钟内完成一次测试发送。

---

# 2. 当前基线与本次边界

## 2.1 当前项目中必须保留的能力

- BBO/OneKey 房源搜索、导入、刷新和媒体复制。
- BBO Nearby Agent recipient matching。
- Contacts、Saved Audiences 和 Suppressions。
- AI Listing/Campaign copy provider abstraction。
- Campaign Draft、Preview、Test Send、Ready、Snapshot、Queue、Send。
- Resend provider。
- Worker queue、daily quota、send window、retry、pause/resume/cancel。
- Webhook、delivery/open/click/bounce/complaint 事件。
- Manual Review 和审计日志。
- Azure Container Apps、PostgreSQL、Blob、Key Vault、Entra、Bicep、GitHub Actions。

## 2.2 本次不做

- [ ] 不重写邮件投递引擎。
- [ ] 不更换 Resend。
- [ ] 不绕过 Suppression。
- [ ] 不删除 Campaign snapshot。
- [ ] 不删除 Required Test Send 安全规则。
- [ ] 不重做 BBO 服务。
- [ ] 不新建第二套 CRM。
- [ ] 不增加无关功能。
- [ ] 不将整个应用迁移到另一种前端框架。
- [ ] 不引入重量级设计系统或复杂状态管理库，除非有明确必要。

## 2.3 当前前端问题

当前实现主要集中于：

```text
client/src/app/App.tsx     约 4,485 行
client/src/styles.css      约 1,192 行
```

当前普通发送流程包含过多显式步骤：

```text
Campaign name
Listing
Audience
Sender
Template
Subject
Introduction
CTA
Review
Create draft
Generate AI variants
Apply
Preview
Test email address
Allowlisted test
Mark ready
Snapshot & send
```

这些内部步骤必须在 V3 中被自动化或隐藏。

---

# 3. 非谈判 UX 原则

## 3.1 普通用户不得看到的词

普通 Marketer 页面中不得显示以下内部术语：

```text
Snapshot
Mark ready
Allowlisted test
Idempotency
Provider event
Source facts JSON
BBO
Azure OpenAI
Model name
Manual-review batch
Campaign version
Frozen recipients
Technical audit
Webhook reconciliation
```

这些内容只能出现在：

```text
Settings → Operations
Campaign → Advanced technical details
ADMIN role
```

## 3.2 用户可见替代文案

| 当前文案                           | 新文案                        |
| ---------------------------------- | ----------------------------- |
| Create campaign                    | Create listing email          |
| Listings                           | Properties / Property Library |
| Audience                           | Recipients                    |
| Sender Profile                     | From                          |
| Send allowlisted test              | Send test to me               |
| Mark ready                         | 隐藏，由系统自动处理          |
| Snapshot & send                    | Send campaign                 |
| Eligible                           | Recipients                    |
| Accepted                           | Submitted                     |
| Manual Review                      | Needs attention               |
| AI copy assistant · provider/model | AI writing assistant          |
| Generate 3 variants                | Rewrite with AI               |
| Apply selected fields              | Use this draft                |
| OneKey MLS · via BBO               | OneKey MLS                    |
| Source facts                       | Property details              |
| Delivery controls active           | 不在普通顶部导航展示          |

## 3.3 操作原则

- [ ] 所有合理默认值自动填充。
- [ ] 只有例外情况才进入 `Advanced settings`。
- [ ] 所有编辑自动保存。
- [ ] 用户离开页面前不需要点击 Save。
- [ ] Routine workflow 不使用 `window.prompt()`。
- [ ] Routine workflow 不使用 `window.confirm()`。
- [ ] 使用统一 Dialog、Drawer、Toast 和 Inline Validation。
- [ ] Loading 状态保持清晰可见，不允许整页低对比度淡出。
- [ ] 错误必须告诉用户“发生了什么”和“下一步做什么”。

---

# 4. 新信息架构

## 4.1 一级导航

将当前：

```text
Dashboard
Listings
Contacts
Audiences
Campaigns
Analytics
Settings
```

改为：

```text
Home
Campaigns
Contacts
Reports
Settings
```

## 4.2 路由

建议路由结构：

```text
/                         Home
/campaigns                Campaign list
/campaigns/new            New listing email / property search
/campaigns/:id/edit       Single-page Campaign Composer
/campaigns/:id            Campaign result/detail
/contacts                 Contacts
/contacts?tab=lists       Lists & segments
/reports                  Reports
/settings                 Settings
/settings/operations      Admin operations
/properties               Property Library（次级入口，不放一级导航）
```

## 4.3 旧路由兼容

- [ ] `/listings` redirect 到 `/properties`。
- [ ] `/audiences` redirect 到 `/contacts?tab=lists`。
- [ ] `/analytics` redirect 到 `/reports`。
- [ ] 旧 deep links 不得 404。

## 4.4 Property Library 的定位

Property Library 继续保留，但不再是日常发送前置步骤。

用途：

- OneKey imported property cache。
- Marketing overrides。
- Source refresh。
- Media refresh。
- Campaign history。
- 手工房源。
- 高级 AI property copy。

普通发送应从 Home 或 `/campaigns/new` 直接开始。

---

# 5. P0 — 重构前端代码结构

先做不改变业务行为的结构拆分，再实现新 UX。

## 5.1 拆分 `App.tsx`

- [ ] 创建 `client/src/app/AppRouter.tsx`。
- [ ] 创建 `client/src/app/AppShell.tsx`。
- [ ] 创建 `client/src/app/AuthGate.tsx`。
- [ ] 创建 `client/src/pages/HomePage.tsx`。
- [ ] 创建 `client/src/pages/CampaignsPage.tsx`。
- [ ] 创建 `client/src/pages/CampaignComposerPage.tsx`。
- [ ] 创建 `client/src/pages/CampaignDetailPage.tsx`。
- [ ] 创建 `client/src/pages/ContactsPage.tsx`。
- [ ] 创建 `client/src/pages/ReportsPage.tsx`。
- [ ] 创建 `client/src/pages/SettingsPage.tsx`。
- [ ] 创建 `client/src/pages/PropertyLibraryPage.tsx`。

## 5.2 Feature 组件目录

```text
client/src/features/
├── property-picker/
│   ├── PropertySearch.tsx
│   ├── PropertySearchResult.tsx
│   ├── PropertySummaryCard.tsx
│   └── usePropertyImport.ts
├── campaign-composer/
│   ├── CampaignComposer.tsx
│   ├── ComposerHeader.tsx
│   ├── ComposerStatus.tsx
│   ├── ComposerActionBar.tsx
│   └── useCampaignAutosave.ts
├── recipient-picker/
│   ├── RecipientPicker.tsx
│   ├── NearbyAgentsOption.tsx
│   ├── SavedListOption.tsx
│   ├── CustomSegmentOption.tsx
│   └── RecipientEstimate.tsx
├── ai-copy/
│   ├── AiDraftPanel.tsx
│   ├── SubjectVariants.tsx
│   └── RewriteMenu.tsx
├── email-composer/
│   ├── EmailFields.tsx
│   ├── EmailPreview.tsx
│   ├── DesktopMobileToggle.tsx
│   └── TemplateSettingsDrawer.tsx
├── send-flow/
│   ├── TestSendButton.tsx
│   ├── SendReviewDialog.tsx
│   ├── ScheduleDialog.tsx
│   └── DeliveryProgress.tsx
└── operations/
    ├── TechnicalDetailsDrawer.tsx
    └── ManualReviewPanel.tsx
```

## 5.3 UI primitives

```text
client/src/components/ui/
├── Button.tsx
├── Card.tsx
├── Dialog.tsx
├── Drawer.tsx
├── DropdownMenu.tsx
├── EmptyState.tsx
├── ErrorBanner.tsx
├── Field.tsx
├── Input.tsx
├── Select.tsx
├── Skeleton.tsx
├── StatusBadge.tsx
├── Tabs.tsx
├── Toast.tsx
└── Tooltip.tsx
```

- [ ] 不复制粘贴按钮和表单样式。
- [ ] 每个 primitive 有明确 variant 和 size。
- [ ] 不需要安装大型 UI framework；优先使用当前 React + CSS + Lucide。
- [ ] Dialog 必须支持 Escape、focus trap、恢复焦点。

## 5.4 CSS 拆分

```text
client/src/styles/
├── tokens.css
├── base.css
├── layout.css
├── components.css
├── composer.css
├── tables.css
└── responsive.css
```

- [ ] `client/src/styles.css` 最终只负责 import，或删除。
- [ ] 单个页面组件文件建议不超过 500 行。
- [ ] 单个 CSS 文件建议不超过 500 行。

---

# 6. P0 — Home 页面改成唯一主入口

## 6.1 Home 页面结构

Home 第一屏不得以 4 个大数字和空图表为中心。

第一屏必须是：

```text
Create a listing email

[ Enter MLS number or property address                     ] [ Search ]

Recent properties
Recent campaigns
Needs attention
```

## 6.2 Property search

- [ ] 搜索框接受 MLS Number 或地址。
- [ ] 复用现有 `/api/v2/onekey/listings/search`。
- [ ] 输入少于合理字符时不调用 API。
- [ ] 按 Enter 可搜索。
- [ ] 显示明确 loading skeleton。
- [ ] 搜索结果每条显示：
  - 主图或 placeholder。
  - 地址。
  - MLS Number。
  - Status。
  - Property type。
  - Sale/Lease。
  - Price/Rent。
  - Agent/office 可以作为次要信息。
- [ ] 结果按钮文案为 `Use this property`。
- [ ] 不显示 `via BBO`。
- [ ] 没有结果时显示：`No OneKey listing found. Check the MLS number or address.`
- [ ] 提供次级入口：`Create a property manually`。

## 6.3 选择结果后的后台动作

点击 `Use this property` 后，系统自动：

1. 查找本地是否已存在相同 `sourceKey` 的 Listing。
2. 存在则复用。
3. 不存在则调用现有 OneKey import。
4. 解析默认 Agent。
5. 创建或复用 quick draft Campaign。
6. 导航到 `/campaigns/:id/edit`。

用户只看到：

```text
Preparing your listing email…
```

不得要求用户先进入 Property Library。

## 6.4 Recent 区域

- [ ] Recent properties 最多 5 个。
- [ ] 点击 Property 直接创建/恢复 Composer。
- [ ] Recent campaigns 显示：Property、status、last edited/sent。
- [ ] `Needs attention` 只显示真实需要处理的项目：
  - 自动暂停。
  - Complaint spike。
  - High bounce rate。
  - Manual review。
  - Failed webhook reconciliation。
- [ ] 没有 action item 时不显示空白大卡片。

---

# 7. P0 — 增加 Quick Start 编排

为了避免前端拼接多个内部步骤，增加一个小型 server-side orchestration service。

## 7.1 Endpoint

新增或等价实现：

```http
POST /api/v2/campaigns/quick-start
```

Input：

```json
{
  "listingId": "uuid"
}
```

Output：

```json
{
  "campaign": {},
  "created": true,
  "defaults": {
    "senderResolved": true,
    "replyToResolved": true,
    "templateResolved": true
  }
}
```

## 7.2 Quick Start 默认值

系统自动设置：

- `name`：`{short address} · {YYYY-MM-DD}`。
- `listingId`：选中的 Listing。
- `senderProfileId`：默认、VERIFIED、ACTIVE Sender。
- `replyToAgentId`：Listing Agent。
- `templateKey`：`LISTING_BRANDED`。
- `subject`：deterministic fallback，例如 `New Listing: {address}`。
- `preheader`：由 listing facts 生成安全 fallback。
- `introHtml`：安全 fallback。
- `ctaLabel`：`View Listing`。
- `ctaUrl`：优先 Listing URL，否则 Homix Listings URL。
- `audienceFilter`：安全默认，要求 known permission。
- `timezone`：`America/New_York`。

## 7.3 Quick Start 行为

- [ ] 使用 Idempotency-Key 防止双击产生多个草稿。
- [ ] 同一用户、同一 Listing、短时间内已有可编辑 draft 时，返回该 draft，而不是重复创建。
- [ ] 写入 audit log。
- [ ] 如果没有 verified default sender，返回可操作错误：
      `No verified sender is configured. Ask an admin to configure the From address.`
- [ ] 不改变现有通用 `POST /campaigns`。

---

# 8. P0 — Single-page Campaign Composer

## 8.1 页面结构

Desktop 使用左右双栏：

```text
┌────────────────────────────────────────────────────────────────────┐
│ Back to campaigns        Property address       Saved just now     │
├────────────────────────────────┬───────────────────────────────────┤
│ LEFT: Edit                    │ RIGHT: Live email preview          │
│                              │                                   │
│ 1. Property                  │ Desktop / Mobile toggle             │
│ 2. Recipients                │                                   │
│ 3. Message                   │ Rendered email                      │
│ 4. Advanced (collapsed)      │                                   │
│                              │                                   │
├────────────────────────────────┴───────────────────────────────────┤
│ 540 recipients · Test current        Test · Schedule · Send        │
└────────────────────────────────────────────────────────────────────┘
```

## 8.2 页面规则

- [ ] 不使用 5-step Wizard。
- [ ] 所有主要编辑区域在同一页面。
- [ ] 右侧 Preview sticky。
- [ ] 底部 Action Bar sticky。
- [ ] 页面刷新恢复同一 Campaign。
- [ ] 用户编辑时自动保存。
- [ ] 保存失败时不得静默；显示 persistent error banner 和 Retry。
- [ ] 只在 advanced drawer 中显示技术字段。

---

# 9. P0 — Property 区域

## 9.1 默认显示

Property 卡片显示：

- 主图。
- Address。
- MLS Number。
- Status。
- Property type。
- Transaction type。
- Price/Rent。
- 核心 facts。
- Listing Agent。

按钮：

```text
Change property
Refresh from OneKey（放 More menu）
Edit property details（放 More menu）
```

## 9.2 不显示

普通 Composer 不显示：

- 原始 facts JSON。
- source sync status 枚举。
- media retry 技术状态。
- source key。
- provider 名称。

## 9.3 Source warning

仅当真实异常存在时显示简明提示：

```text
Some property photos could not be copied.
[Retry photos]
```

或：

```text
This property has changed in OneKey since the draft was created.
[Review changes]
```

---

# 10. P0 — Recipients 区域

## 10.1 三个业务选项

用户只看到三种选择：

### A. Nearby active agents

```text
Nearby active agents
Agents with recent closed transactions in this ZIP and nearby ZIPs.
Estimated recipients: 540
```

默认用于 OneKey Listing。

### B. Saved contact list

```text
Saved contact list
[ Select a list ]
```

### C. Custom segment

```text
Custom segment
[ Build filters ]
```

## 10.2 Nearby active agents 默认值

默认：

```text
Same ZIP + 3 nearby ZIPs
Closed transaction window: 12 months
Limit: existing safe production limit
```

这些默认值不直接占据主页面。

`Adjust criteria` 打开 Drawer：

- Nearby ZIP count。
- Closed months。
- Maximum recipients。
- Exclude recently emailed contacts。

## 10.3 自动化现有 BBO recipient flow

选择 `Nearby active agents` 时，系统后台自动完成：

1. Preview BBO candidate count。
2. Import/update contacts as business contacts。
3. Apply global suppressions。
4. Create/reuse generated saved audience。
5. Patch current Campaign audience。
6. Refresh recipient estimate。

用户不得被要求：

```text
Preview matched agents
Import contacts & saved audience
去 Audiences 页面
返回 Campaign 选择该 Audience
```

## 10.4 推荐新增 orchestration endpoint

新增或等价实现：

```http
POST /api/v2/campaigns/:id/recipients/onekey-nearby
```

Input：

```json
{
  "nearbyZipCount": 3,
  "closedMonths": 12,
  "limit": 2000,
  "version": 3
}
```

行为：

- 获取 BBO candidates。
- 幂等 import/update Contacts。
- 创建或复用该 Campaign/criteria 对应 Audience。
- 更新 Campaign audienceFilter/savedAudienceId。
- 返回 estimate summary。
- Campaign version 正确递增。
- 清除 current-version test status。
- 写 audit log。

Output：

```json
{
  "matched": 612,
  "eligible": 540,
  "suppressed": 12,
  "recentlyContactedExcluded": 38,
  "alreadyReceivedListingExcluded": 7,
  "campaignVersion": 4
}
```

## 10.5 Recipient summary

主页面只显示：

```text
540 will receive this email
72 excluded
```

点击 `View exclusions` 显示：

- Suppressed / unsubscribed。
- Invalid email。
- Recently contacted。
- Already received same listing。
- Unknown permission basis。

## 10.6 防误发选项

默认打开：

- [x] Exclude contacts emailed in the last 14 days。
- [x] Exclude contacts who already received this listing。
- [x] Exclude suppressed and complained addresses。
- [x] Require a known business/permission source。

这些规则不能通过普通用户随意关闭；需要 Admin/Advanced 权限。

---

# 11. P0 — AI 邮件草稿

## 11.1 一个 AI 概念

普通用户只看到：

```text
AI writing assistant
```

不得要求用户区分：

```text
Listing AI
Campaign AI
Provider
Model
Prompt version
```

这些信息继续保存到审计和 Technical Details。

## 11.2 初始草稿行为

选中 Property 并创建 quick draft 后：

1. 页面立即显示 deterministic fallback，不出现空白表单。
2. 如果 AI production-ready 且当前 Campaign 尚无 AI draft：
   - 自动请求一次 AI Campaign copy。
   - 显示 `Writing your email…`。
   - 成功后自动填入推荐 subject、preheader 和 intro。
   - 标记 `AI draft — review before sending`。
3. AI 失败时保留 deterministic fallback。
4. 不得因 AI 失败阻止 Preview、Test 或 Send。
5. 页面 re-render 不得重复调用 AI。
6. 以 Campaign/version/facts hash 保证一次性和缓存行为。

## 11.3 Message 区域

主页面显示：

```text
Subject
[ Variant 1 ] [ Variant 2 ] [ Variant 3 ]

Preheader
[ editable input ]

Introduction
[ editable rich text ]

CTA
[ View Listing ]
```

- [ ] 推荐 Subject 默认选中。
- [ ] 点击 Variant 立即应用。
- [ ] 所有字段可手工编辑。
- [ ] `Rewrite` 打开小型 Dropdown：
  - More concise。
  - More personal。
  - More professional。
  - Focus on investment details。
- [ ] 不使用字段 checkbox + Current/Proposal JSON 调试式界面。
- [ ] 不显示模型名称。

## 11.4 Property marketing copy

主流程不再要求用户先去 Property Library 运行一次 Listing AI。

Property Library 中继续保留高级 `Improve property description`，但不是发送前置步骤。

Campaign AI 必须使用：

```text
authoritative listing facts
+ current approved marketing fields
+ current campaign content
```

AI 不得虚构 cap rate、NOI、租约、税费、层高、交通距离、收益、分区等不存在事实。

## 11.5 编辑后测试失效

任何会改变发送内容或收件人的修改都必须：

- Campaign version +1。
- 清除 current-version test success。
- UI 显示 `Needs a new test`。
- Send 按钮禁用，直到当前版本 test 成功。

---

# 12. P0 — Live Email Preview

## 12.1 Preview 行为

- [ ] Composer 加载后自动渲染 Preview。
- [ ] 输入停止 300–500ms 后 debounce refresh。
- [ ] 不要求用户点击单独 `Preview` 按钮。
- [ ] Preview 使用现有 server rendering endpoint，确保和正式邮件一致。
- [ ] 显示 Desktop / Mobile 切换。
- [ ] 支持滚动但保持右栏 sticky。
- [ ] Preview 加载时显示 skeleton，不闪烁整页。

## 12.2 Preview header

显示：

```text
From: Homix Realty <listings@...>
Reply-To: Eric Wei <...>
Subject: ...
```

Sender/Reply-To 默认不可在主页面编辑。

`Change From` 仅在 Advanced Settings 中，且只展示 verified sender。

## 12.3 CTA URL

CTA 默认自动来自：

1. Listing URL。
2. Homix property URL。
3. HOMIX_LISTINGS_URL fallback。

普通用户无需填写 URL。

只有 `Advanced settings` 可修改。

---

# 13. P0 — Autosave

## 13.1 行为

- [ ] 任何 field change 800ms debounce 后 PATCH Campaign。
- [ ] 使用现有 If-Match/version 并发控制。
- [ ] Header 显示：
  - `Saving…`
  - `Saved just now`
  - `Save failed · Retry`
- [ ] Version conflict 时获取最新 server data，显示 conflict dialog。
- [ ] 不覆盖另一用户的修改。
- [ ] 未保存时关闭页面显示 app-level navigation warning。

## 13.2 防止 API storm

- [ ] 输入时 debounce。
- [ ] 同一 patch 合并。
- [ ] 旧请求响应不得覆盖新状态。
- [ ] Abort obsolete preview requests。
- [ ] Autosave 与 AI apply 使用同一个 version synchronization strategy。

---

# 14. P0 — Test Send 简化

## 14.1 主按钮

显示：

```text
Send test to me
```

默认 test email：当前登录用户 email。

普通用户无需看到 email input。

## 14.2 可选测试地址

- [ ] 点击按钮旁 dropdown 可选择已 allowlisted 地址。
- [ ] Admin 可输入其他 allowlisted 地址。
- [ ] 非 allowlisted 地址显示清楚解释。

## 14.3 Test 状态

```text
Not tested
Sending test…
Test sent to eric@...
Needs a new test after edits
Test failed · Retry
```

- [ ] 成功后显示时间。
- [ ] 编辑后自动变成 `Needs a new test`。
- [ ] Test 成功后 Send 按钮启用。

---

# 15. P0 — 正式发送只保留一个业务动作

## 15.1 隐藏内部步骤

用户不得再依次点击：

```text
Mark ready
Snapshot & send
```

## 15.2 新 publish endpoint

新增或等价实现：

```http
POST /api/v2/campaigns/:id/publish
```

Input：

```json
{
  "version": 4,
  "scheduledAt": null
}
```

Header：

```text
Idempotency-Key: uuid
```

行为：

1. Lock Campaign。
2. 验证 Campaign 可编辑/可发送。
3. 验证 current version 已成功 Test Send。
4. 验证 Listing、Sender、Recipient estimate、CTA、subject。
5. 内部完成 DRAFT → READY。
6. 内部创建 recipient/content snapshot。
7. Reserve quota。
8. Queue send now 或 schedule。
9. 写 audit log。
10. 返回用户级状态。

Existing `mark-ready`、`send-now`、`schedule` endpoints 保留给 operations/API compatibility，但普通 Composer 不直接调用。

## 15.3 Send confirmation dialog

点击 Send 后显示简洁确认：

```text
Send this listing email?

Property          91-14 86th Drive
Recipients        540
Excluded          72
From              Homix Realty
Reply-To          Eric Wei
Subject           Just Listed: ...

[Cancel] [Send to 540 recipients]
```

Schedule dialog：

```text
Schedule this listing email
Date
Time (ET)

[Cancel] [Schedule for Aug 25, 10:00 AM]
```

## 15.4 Send 按钮状态

- 未选择 Recipients：disabled，提示 `Choose recipients`。
- Recipient count = 0：disabled。
- 未完成 current-version test：disabled，提示 `Send yourself a test first`。
- 保存中：disabled。
- Publish 请求中：显示 spinner，不可重复点击。
- 成功后导航到 Campaign Detail。

---

# 16. P0 — Campaign Detail 按生命周期重构

不再用一个页面同时堆叠 Draft、AI、Test、Send、Recipients、Events、Content、Audit。

## 16.1 Draft / In progress

Draft 不应打开旧 Detail 页面，而应打开 Composer：

```text
/campaigns/:id/edit
```

## 16.2 Scheduled

显示：

```text
Scheduled
Aug 25, 2026 at 10:00 AM ET
540 recipients

[Edit schedule] [Cancel]
```

内容已锁定时不要显示 editable fields。

## 16.3 Sending / Paused

显示：

```text
Sending
60 of 540 submitted
60 delivered
0 bounced
1 unsubscribed/complaint
480 remaining

[Pause sending]
```

Paused：

```text
Paused
60 sent · 480 remaining

[Resume] [Cancel remaining]
```

## 16.4 Completed

显示：

- Sent/submitted。
- Delivered。
- Opened（注明 tracking limitations，不夸大准确性）。
- Clicked。
- Bounced。
- Unsubscribed。
- Complaints。
- Recipient table。

Primary actions：

```text
Duplicate
View email
Export recipients
```

## 16.5 Technical details

默认隐藏在：

```text
More → Technical details
```

包括：

- Raw events。
- Content snapshot JSON。
- Audience snapshot JSON。
- Audit log。
- Manual review。
- Provider IDs。

仅 Admin 或明确授权用户可见。

---

# 17. P1 — 视觉设计系统

## 17.1 设计方向

目标是“高频内部工作台”，不是地产宣传册。

保留：

- Homix 深绿色品牌。
- Logo。
- 少量暖橙色强调。

移除/调整：

- [ ] 移除全页点阵背景。
- [ ] 应用 UI 使用 system sans-serif。
- [ ] Serif 只用于 Logo 或 Email Preview 内的品牌标题。
- [ ] 页面大标题从约 60–70px 降为 30–36px。
- [ ] 普通正文 14–15px。
- [ ] 辅助文字不小于 12px。
- [ ] 减少全大写 eyebrow。
- [ ] 提高 muted text 对比度。
- [ ] 减少同质化大边框 Panel。

## 17.2 Design tokens

建议：

```css
--color-bg: #f6f7f5;
--color-surface: #ffffff;
--color-surface-subtle: #f0f3f0;
--color-border: #dde3de;
--color-text: #17211b;
--color-muted: #5f6b64;
--color-primary: #174a36;
--color-primary-hover: #103b2a;
--color-accent: #b85f32;
--color-success: #27734f;
--color-warning: #a5671e;
--color-danger: #b23a34;
--shadow-card: 0 1px 2px rgba(17, 33, 24, 0.05);
--radius-sm: 6px;
--radius-md: 10px;
--radius-lg: 14px;
```

Spacing：

```text
4 / 8 / 12 / 16 / 24 / 32 / 48
```

## 17.3 Sidebar / topbar

- [ ] Sidebar desktop width 208–224px。
- [ ] Logo 区域更紧凑。
- [ ] 一级导航最多 5 项。
- [ ] 当前页面高亮清晰，但不使用过大色块。
- [ ] Topbar 只显示 page actions 和用户 menu。
- [ ] `Delivery controls active` 移到 Settings/Operations。
- [ ] `All times shown in ET` 仅在日期/时间相关页面显示。

## 17.4 Buttons

- Primary：每个页面最多一个明显 Primary。
- Secondary：Test、Schedule、Back。
- Tertiary/Text：Edit、Change、View details。
- Destructive：Cancel remaining、Delete。
- Icon-only 必须有 accessible label 和 tooltip。

## 17.5 Forms

- [ ] Label 在 input 上方。
- [ ] Help text 简短。
- [ ] Error 在 field 下方。
- [ ] 不使用 placeholder 代替 label。
- [ ] Select 不展示内部 enum 名称。
- [ ] Advanced fields 放 Drawer。
- [ ] 表单控件高度统一。

## 17.6 Tables

- [ ] Contacts/Campaigns 表格使用 sticky header。
- [ ] 行高 44–52px。
- [ ] 支持 search/filter。
- [ ] Mobile 变为 cards 或横向滚动。
- [ ] 不默认显示过多技术列。

---

# 18. P1 — Campaigns 页面

## 18.1 页面顶部

```text
Campaigns
[ Search campaigns ]                         [ Create listing email ]

All · Drafts · Scheduled · Sending · Sent · Needs attention
```

## 18.2 Campaign row/card

显示：

- Property thumbnail。
- Property address/title。
- Subject。
- Status（业务语言）。
- Recipient count。
- Sent/scheduled date。
- Last edited。

隐藏：

- Internal campaign UUID。
- Sender profile technical status。
- Version。
- Raw state enum。

## 18.3 Status 映射

| Internal               | User-facing                             |
| ---------------------- | --------------------------------------- |
| DRAFT                  | In progress                             |
| READY                  | Ready to send（通常只瞬时存在，不突出） |
| SCHEDULED              | Scheduled                               |
| QUEUED                 | Preparing                               |
| SENDING                | Sending                                 |
| PAUSED                 | Paused                                  |
| COMPLETED              | Sent                                    |
| CANCELLED              | Cancelled                               |
| FAILED / Manual Review | Needs attention                         |

---

# 19. P1 — Contacts 页面

将 Audiences 合并到 Contacts。

Tabs：

```text
All contacts
Lists & segments
Imports
Suppressed
```

## 19.1 All contacts

- Search。
- Filter：Contact type、Source、Permission、Last emailed。
- Bulk actions 放在 selection 后出现。
- 不默认显示所有数据库字段。

## 19.2 Lists & segments

- Saved Audience 改称 `Saved list` 或 `Segment`。
- 显示 estimated active recipients。
- 可以从这里管理高级 filter。
- 主 Campaign Composer 只需选择，不要求先管理。

## 19.3 Suppressed

普通 Marketer 只读。

显示业务解释：

```text
These addresses are automatically excluded from marketing emails.
```

---

# 20. P1 — Reports 页面

不要在数据为空时显示巨大空图表。

默认显示：

- Campaign performance table。
- 过去 30 天 sent/delivered/clicked/bounced/complained。
- Sender health warning。
- 最近 Campaign。

当数据不足时显示简洁 Empty State。

---

# 21. P1 — Settings 分层

Settings 分为：

```text
General
Sending
Team
Integrations
Operations（Admin only）
```

## 21.1 General

- Default sender。
- Default reply-to behavior。
- Default template。
- Default timezone。
- Default test recipient。

## 21.2 Sending

- Sender Profiles。
- Daily quota。
- Send window。
- Warm-up。

普通 Marketer 只读关键设置。

## 21.3 Integrations

- OneKey MLS：Connected / Error。
- AI writing：Connected / Error。
- Resend：Connected / Error。
- Azure Storage：Connected / Error。

不得显示 secret values。

## 21.4 Operations

- Manual Review。
- Webhook reconciliation。
- Worker heartbeat。
- Raw audit logs。
- Technical delivery controls。

仅 Admin。

---

# 22. P0/P1 — Loading、Error、Empty、Toast

## 22.1 Loading

- [ ] 页面 skeleton 清晰，文字对比正常。
- [ ] 不使用整个页面 opacity 接近不可见的 loading。
- [ ] 不闪烁旧数据和空数据。
- [ ] 搜索和 autosave 只在局部显示 loading。

## 22.2 Error

错误文案模板：

```text
We couldn't search OneKey right now.
Your work is saved. Try again.
[Retry]
```

```text
The test email wasn't sent.
Check the test recipient or ask an admin to review email settings.
[Try again]
```

不得只显示原始 server message 或 stack trace。

## 22.3 Toast

需要统一 Toast Provider：

- Property imported。
- Draft saved。
- AI draft ready。
- Test sent。
- Campaign scheduled。
- Campaign queued。
- Copy to clipboard。

错误不是短暂 toast 后消失；关键错误保留 inline/banner。

## 22.4 Empty states

每个 Empty State 必须有下一步：

```text
No campaigns yet
Create your first listing email.
[Create listing email]
```

---

# 23. P0 — Responsive 与移动端

## 23.1 Desktop

- Composer 双栏。
- Preview sticky。
- Action bar sticky。

## 23.2 Tablet

- Composer 单栏。
- Preview 可折叠或切换 Tab。
- Action bar sticky bottom。

## 23.3 Mobile

- Property / Recipients / Message / Preview 使用顶部 segmented control 或顺序 sections。
- Preview 进入 full-screen drawer。
- Primary action 全宽。
- 不出现横向溢出。
- Dialog 在小屏使用 bottom sheet/full screen。

## 23.4 Breakpoints

合理支持：

```text
1440px
1024px
768px
390px
```

---

# 24. P0 — Accessibility

- [ ] 所有表单有 label。
- [ ] 所有 icon button 有 accessible name。
- [ ] Keyboard 可完成整个 Composer。
- [ ] Dialog 有 focus trap。
- [ ] Toast 使用 appropriate aria-live。
- [ ] Loading 使用 aria-busy。
- [ ] Error summary 可被 screen reader 读取。
- [ ] Focus visible 明确。
- [ ] 普通文字对比不低于 WCAG AA。
- [ ] 不仅靠颜色表示状态。
- [ ] Subject variant 可通过键盘选择。
- [ ] Mobile/desktop preview toggle 是语义化控件。

---

# 25. P0 — 安全与业务规则不得因 UX 简化而降低

- [ ] Test Send 仍然 required for current version。
- [ ] Suppression 仍在 send time 再检查。
- [ ] Complaint/bounce/unsubscribe 仍自动阻止未来发送。
- [ ] Publish 使用 Idempotency-Key。
- [ ] Audience/content snapshot 仍不可变。
- [ ] Daily quota 和 send window 仍 enforce。
- [ ] AI 失败不阻止手工发送。
- [ ] AI 不得虚构 facts。
- [ ] OneKey recipient import 仍记录来源与 permission basis。
- [ ] 所有 quick orchestration action 仍写 Audit Log。
- [ ] 普通用户无法访问 raw secret 或技术配置。

---

# 26. 数据库与 API 变更原则

## 26.1 优先无 migration

优先复用现有：

- Campaign。
- SavedAudience。
- Contact。
- Listing。
- SenderProfile。
- AiGeneration。
- TestSendRecord。

## 26.2 允许的小型兼容变更

只有确实需要时，可增加：

- Quick draft reuse key / lastOpenedAt。
- Campaign composer UI metadata。
- Generated audience criteria hash。
- User default/preferences。

任何 migration 必须：

- 向后兼容。
- 可在现有 Azure PostgreSQL 上安全部署。
- 不删除生产数据。
- 有 migration test。

---

# 27. API 客户端与 React Query

- [ ] 将 `client/src/lib/api.ts` 拆出 typed domain clients：

```text
client/src/api/campaigns.ts
client/src/api/listings.ts
client/src/api/contacts.ts
client/src/api/onekey.ts
client/src/api/settings.ts
```

- [ ] Query keys 集中定义。
- [ ] Mutation 成功后精确 invalidate，不全局乱刷。
- [ ] 不在 UI 组件中拼接大量 URL 和 raw JSON。
- [ ] 所有 API error 映射为用户可读错误。
- [ ] Abort outdated search/preview requests。

---

# 28. 测试要求

## 28.1 Unit tests

至少新增：

- [ ] Default Campaign name generation。
- [ ] Default sender resolution。
- [ ] Default CTA resolution。
- [ ] Internal status → user status mapping。
- [ ] Autosave debounce/merge。
- [ ] Send eligibility calculation。
- [ ] Test status invalidation after edit。
- [ ] Recipient summary/exclusion formatting。
- [ ] AI fallback behavior。

## 28.2 API tests

- [ ] `campaigns/quick-start` creates correct defaults。
- [ ] Quick-start is idempotent。
- [ ] Quick-start reuses recent editable draft。
- [ ] No verified sender returns actionable error。
- [ ] OneKey nearby recipient orchestration is idempotent。
- [ ] OneKey orchestration updates Campaign version。
- [ ] Publish refuses untested current version。
- [ ] Publish internally readies and queues Campaign。
- [ ] Publish is idempotent。
- [ ] Scheduled publish works。
- [ ] Suppression remains enforced。
- [ ] Audit entries exist。

## 28.3 Component tests

- [ ] Property search keyboard flow。
- [ ] Composer loads and shows defaults。
- [ ] Recipient option change updates estimate。
- [ ] Subject variant selection updates Preview。
- [ ] Autosave states。
- [ ] Test button states。
- [ ] Send dialog summary。
- [ ] Advanced drawer hidden by default。
- [ ] Error retry flow。

## 28.4 E2E — 核心路径

### E2E 1：OneKey nearby agents, send now

```text
Login
→ Home
→ Search MLS
→ Select result
→ Composer opens
→ Nearby agents auto-selected
→ AI draft visible
→ Preview visible
→ Send test to me
→ Test succeeds
→ Send campaign
→ Confirm recipient count
→ Campaign enters queued/sending
```

### E2E 2：Saved contact list, schedule

```text
Search property
→ Select Saved contact list
→ Choose list
→ Edit subject
→ New test required
→ Send test
→ Schedule tomorrow 10:00 ET
→ Scheduled detail page
```

### E2E 3：AI unavailable

```text
AI provider fails
→ deterministic draft remains
→ user edits manually
→ test/send still works
```

### E2E 4：Autosave/refresh

```text
Open draft
→ edit subject
→ wait for Saved
→ refresh browser
→ content restored
```

### E2E 5：Suppression/exclusion

```text
Audience contains suppressed and recently contacted addresses
→ summary shows exclusions
→ final snapshot excludes them
```

### E2E 6：Mobile

```text
390px viewport
→ property search
→ composer
→ preview drawer
→ test
→ send confirmation
```

## 28.5 Visual regression

保存并审查以下截图：

```text
home-empty.png
home-search-results.png
composer-desktop.png
composer-ai-writing.png
composer-test-complete.png
send-review-dialog.png
campaign-sending.png
campaign-completed.png
contacts.png
settings-operations.png
composer-mobile.png
```

不得只运行 screenshot；需要人工/自动检查 overflow、contrast、loading 和状态变化。

---

# 29. 性能要求

- [ ] 初始 JS bundle 不因 UI 重构大幅膨胀。
- [ ] Reports/Settings/Operations 可 route-level lazy load。
- [ ] Property search debounce。
- [ ] Preview debounce + cancellation。
- [ ] Composer 不因每次输入重新获取所有 Contacts/Listings。
- [ ] 大 recipient count 不将全部 recipient rows 加载到 Composer。
- [ ] 图片使用 thumbnail 尺寸。
- [ ] Lighthouse/浏览器检查无明显 layout shift。

---

# 30. 埋点与使用效果

增加轻量 product events，不记录邮件正文或敏感数据：

```text
campaign_start
property_search
property_selected
recipient_source_selected
ai_draft_generated
ai_draft_failed
test_send_started
test_send_succeeded
publish_started
publish_succeeded
publish_failed
composer_abandoned
```

至少记录：

- userId。
- campaignId。
- timestamp。
- duration from start to test/send。
- action result。

用于判断：

- 平均完成时间。
- 卡在哪一步。
- AI 使用率。
- Test → Send 转化率。

不得将 email body、contact email list 或 secret 写入 analytics。

---

# 31. 具体 UI 文案

## Home

```text
Create a listing email
Search OneKey by MLS number or property address.
```

Search placeholder：

```text
Enter MLS number or property address
```

## Composer sections

```text
Property
Recipients
Message
Email preview
```

## Recipients

```text
Nearby active agents
Saved contact list
Custom segment
```

## AI

```text
AI writing assistant
Writing your email…
AI draft — review before sending
Rewrite
```

## Save

```text
Saving…
Saved just now
Save failed · Retry
```

## Test

```text
Send test to me
Test sent to eric@homixny.com
Needs a new test after edits
```

## Send

```text
Schedule
Send campaign
Send to 540 recipients
```

## Status

```text
In progress
Scheduled
Preparing
Sending
Paused
Sent
Needs attention
Cancelled
```

---

# 32. 禁止实现方式

- [ ] 不得只换颜色而保留 5-step Wizard。
- [ ] 不得把新 Composer 又拆成多个 Modal steps。
- [ ] 不得要求用户先创建 Saved Audience 才能发。
- [ ] 不得要求用户先手工 Import OneKey recipients。
- [ ] 不得要求用户手工 Mark Ready。
- [ ] 不得删除当前 Test Send 安全规则。
- [ ] 不得在前端绕过 server validation。
- [ ] 不得把 `App.tsx` 继续扩展到更多行。
- [ ] 不得新增第二个大 CSS 文件来继续堆全局样式。
- [ ] 不得显示 raw enum/JSON 给普通用户。
- [ ] 不得把 secrets 放入客户端 bundle。
- [ ] 不得修改 BBO 正式路径为直接 MLS Grid。
- [ ] 不得破坏现有 Azure deployment。
- [ ] 不得删除旧 API 而不保留兼容或迁移。

---

# 33. 实施顺序

## Phase 1 — 安全拆分，不改变行为

- [ ] 拆 AppRouter/AppShell/pages/features。
- [ ] 拆 CSS。
- [ ] 保持当前测试通过。
- [ ] Commit：`refactor(ui): split monolithic app without behavior changes`。

## Phase 2 — Quick Start 和 Composer orchestration

- [ ] Quick-start endpoint。
- [ ] OneKey nearby recipient endpoint。
- [ ] Publish endpoint。
- [ ] API tests。
- [ ] Commit：`feat(campaigns): add simplified composer orchestration`。

## Phase 3 — 新 Home 和 Composer

- [ ] Home property search。
- [ ] Single-page Composer。
- [ ] Autosave。
- [ ] AI draft。
- [ ] Preview。
- [ ] Test/Send。
- [ ] Commit：`feat(ui): replace campaign wizard with single-page composer`。

## Phase 4 — Lifecycle pages 和 secondary pages

- [ ] Campaign Detail by status。
- [ ] Contacts/Audiences merge。
- [ ] Reports。
- [ ] Settings layering。
- [ ] Commit：`feat(ui): simplify campaign lifecycle and navigation`。

## Phase 5 — Visual polish / responsive / accessibility

- [ ] Design tokens。
- [ ] Remove dot background。
- [ ] Typography。
- [ ] Mobile。
- [ ] Accessibility。
- [ ] Commit：`style(ui): apply Homix workspace design system`。

## Phase 6 — QA

- [ ] Unit/API/component/E2E。
- [ ] Visual screenshots。
- [ ] Docker build。
- [ ] Azure/Bicep unchanged or validated。
- [ ] Commit：`test(ui): cover simplified campaign workflow`。

---

# 34. 必须运行的验证命令

从 clean checkout 执行：

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:api
npm run test:integration
npm run test:coverage
npm run test:e2e
npm run build
npm run docker:build
npm run openapi:lint
npm run infra:lint
npm run licenses:check
npm audit --audit-level=high
npm run source:archive:check
```

如果本项目新增 component test script，必须同时运行。

任何失败必须修复或在最终报告中明确列出，不能忽略。

---

# 35. Definition of Done

只有全部满足，才能声称完成：

- [ ] 旧 5-step Campaign Wizard 已从普通流程移除。
- [ ] Home 可以直接搜索 MLS/地址。
- [ ] 选择房源后自动 import/reuse + quick-start。
- [ ] Campaign Composer 是单页面。
- [ ] Sender、Reply-To、Template、Campaign Name 自动默认。
- [ ] Nearby Agents 选择不再要求手工 import audience。
- [ ] AI 邮件草稿自动准备，失败有 fallback。
- [ ] Live Preview 始终可见。
- [ ] Autosave 正常。
- [ ] Test Send 简化为 `Send test to me`。
- [ ] 用户看不到 Mark Ready。
- [ ] 用户只点击 `Send campaign`，server 内部完成 ready/snapshot/queue。
- [ ] Send confirmation 显示 recipient/exclusion summary。
- [ ] Campaign detail 按生命周期显示。
- [ ] Audiences 合并到 Contacts。
- [ ] 普通 UI 不显示 BBO、provider、model、snapshot 等术语。
- [ ] 点阵背景移除，标题、字体、对比度、卡片层级完成重构。
- [ ] Desktop、tablet、mobile 都可用。
- [ ] App.tsx 和 styles.css 已合理拆分。
- [ ] 现有投递后端、BBO、Resend、Webhook、Suppression、Quota 均未破坏。
- [ ] 现有 60 封 canary 可用能力仍通过等价回归测试。
- [ ] 所有强制验证命令通过。
- [ ] README 和操作说明更新为新流程。

---

# 36. Codex 最终报告格式

最终回复必须严格包含：

## 1. Outcome

说明最终用户现在如何在最少步骤内完成邮件发送。

## 2. Files changed

按以下分组列出：

```text
Frontend pages
Feature components
UI primitives/styles
Backend orchestration
Tests
Documentation
Migrations
```

## 3. User flow

逐步说明：

```text
MLS/address → property → recipients → AI email → test → send
```

## 4. API changes

列出新增/修改 endpoint、input/output、幂等策略和权限。

## 5. Database changes

列出 migration；如果没有，明确写 `No database migration required`。

## 6. Verification

逐条列出命令和实际通过/失败结果。

## 7. Screenshots

列出新 UI screenshot 路径。

## 8. Remaining manual steps

只列真正需要人工完成的 Azure/Resend/OneKey 配置；不得把未完成代码工作伪装成人工步骤。

## 9. Known limitations

准确说明仍然存在的问题。

---

# 37. 最终产品判断标准

不要以“功能都还在”作为成功标准。

成功标准是：

> Homix 用户进入系统，输入一个 MLS Number 或地址，不需要理解 Campaign 状态机，不需要在多个模块来回跳转，就可以在一个清晰页面内完成收件人选择、AI 邮件审核、测试和发送。

如果用户仍然必须学习 `Listing → Audience → Sender → Content → Review → Draft → AI → Mark Ready → Snapshot`，则本次重构失败。
