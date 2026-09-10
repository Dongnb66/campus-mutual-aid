# 校园互助平台 · 多智能体增强版（Campus Mutual-Aid · Multi-Agent）

一个**用多智能体编排解决"校园互助匹配效率低、内容难管控"问题**的全栈平台。
核心业务是一条**多智能体协作流水线**：需求理解 → 发帖引导 → 内容审核 → 检索 → 智能撮合，
各环节由独立智能体承担、可单独调试与替换；同时用 **LLM 关键词抽取 + 检索智能体**（RAG 检索链路：查询抽取 → 结构化过滤 → 结果重排）做"需求–资源"精准匹配，
并用 **内容审核智能体** 自动拦截违规信息、**信用撮合** 建立用户信任体系，形成完整业务闭环。

> 以真实用户调研（N=120，传统平台需求满足率仅 41%）驱动产品设计。
> 第 22 届湖南省大学生计算机程序设计竞赛 · 应用开发类参赛作品（已提交校内选拔）。

## ✨ 多智能体流水线

后端 `backend/src/agents.js` 定义了 5 个可独立调用/替换的智能体：

| 智能体 | 函数 | 职责 |
|---|---|---|
| **路由 Router** | `routeIntent` | 判断用户输入意图，返回结构化 JSON |
| **发帖引导 Post Guide** | `guidePost` | 从一句话里抽取标题/内容/地点/时间/联系方式等结构化帖子字段 |
| **内容审核 Audit** | `auditPost` | 校验内容合规（广告/敏感词/违规/诈骗），违规自动拦截 |
| **检索 Search** | `searchPosts` | 从查询提取检索关键词，走 RAG 检索链路（关键词抽取 → 结构化过滤 → 结果重排）找匹配帖子 |
| **撮合 Match** | `matchPosts` | 按信用分/完成率/活跃度做"需求–服务者"智能撮合推荐 |

关键设计：**每个智能体都支持两套实现——配置了模型 Key 走大模型（DeepSeek 等），未配置自动回退"规则兜底"**，
保证 `clone` 下来**无 Key 也能端到端跑通演示**，同时兼顾成本与可用性。

## 🧱 技术栈

- **前端**：React 18 · Vite 5（`frontend/`）
- **后端**：Node.js ≥22.5 · Express · node:sqlite（内置模块，`backend/`）
- **智能体/大模型**：`llm.js` 统一封装，支持 DeepSeek（默认）/ 任意 OpenAI 兼容协议，可用 `.env` 切换
- **防幻觉**：无检索匹配即走规则兜底/拒答，不让模型凭空编造
- **工程化能力（区别于"纯 Demo"的关键）**：
  - **JWT 双令牌机制**（`access` 短效 + `refresh` 长效可吊销，存库哈希）— `auth.js` `issueTokens` / `/api/auth/refresh`
  - **RBAC 角色权限**：`users.role` 区分 `student` / `admin`，后台接口 `requireRole('admin')` 守护 — `server.js` `/api/admin/*`
  - **数据库事务与原子防并发**：接单用 `UPDATE ... WHERE status='open'` 条件更新包在 `db.transaction` 内，并发下不会重复接单（电商秒杀同款思路）— `db.js` `claimPostAtomic`
  - **缓存层**：`cache.js` 带 TTL + LRU + 缓存穿透防护；热路径（首页列表 / 平台统计）自动走缓存，生产可一键替换为 Redis 适配器（接口一致）
  - **多方式登录与账号绑定**：手机号+密码注册登录，**微信 / QQ 扫码登录**（首次强制验证手机号或邮箱 + 验证码），同一用户可绑多身份 — `auth.js` `phoneLogin` / `oauthLogin` / `bindContact` / `bindCurrentUser`
  - **验证码双通道**：手机号走**腾讯云短信 SMS**（用 Node 内置 `crypto` 自行实现 TC3-HMAC-SHA256 签名，零 SDK 依赖），邮箱走 **SMTP**；未配置自动降级为演示模式，验证码回传前端便于联调
  - **运营维护可观测**：请求日志中间件（方法/路径/状态码/耗时）+ `/api/health` 健康检查 + `/api/admin/ops` 运维看板（数据规模与运行时长 + 通道状态）

> 该平台既可作为 **AI Agent / 多智能体** 作品，也可作为 **全栈 / 后端** 作品：多智能体体现 AI 能力，上面的工程化能力（事务 / 双 token / RBAC / 缓存 / 多方式登录 / 运维可观测）体现真实后端基本功。

## ✅ 测试

```bash
cd backend
npm install
npm test              # 5 个智能体行为测试 + 环境变量加载回归（48 项断言，无需 API Key）
npm run test:smoke    # 全链路冒烟：双 token / RBAC / 原子接单 / 缓存
npm run test:all      # 上面两项一起跑
```

### 智能体测试覆盖了什么

`test_agents.mjs` 用 **fetch 桩把大模型换成可控脚本**，于是"智能体到底有没有真的在调模型"变成可断言的事实，而不是靠读代码相信：

| 断言组 | 关键点 |
|--------|--------|
| 环境变量加载 | **回归守卫**：import 之后再设 Key 也能读到（见下方「修复的两个真 bug」） |
| Router / Post / Audit / Search / Match | 5 个智能体都存在、可调用，且规则兜底路径语义正确（意图分类、字段抽取、待追问字段、关键词检索、打分排序） |
| 内容审核安全性 | 代考 / 刷单 / 办证发票等**违规拦截是代码级黑名单**：模型返回 500 时依然拦得住，安全不依赖模型可用性 |
| 检索注入防护 | 查询里塞 `'; DROP TABLE posts;--` 不影响库与后续检索（全程参数化） |
| 真的在调模型 | 有 Key 时断言请求打到 `/chat/completions`、带 `response_format=json_object`、对模型返回的非法分类做白名单校验 |
| 降级不中断 | 模型 500 → 自动回落规则兜底，接口不报错 |

### 修复的两个真 bug（此前「文档与实现相反」）

| # | 问题 | 影响 | 修法 |
|---|------|------|------|
| 1 | `src/llm.js` 在**模块加载阶段**快照 `process.env.DEEPSEEK_API_KEY`，而 `server.js` 的 `dotenv.config()` 在 import 之后才执行（ESM import 提升） | `.env` 里配了 Key **永远读不到**，5 个智能体静默降级成规则兜底 —— 文档说「可用 `.env` 切换」，实际不行 | 新增 `src/env.js` 作为 server.js 的第一个 import 提前加载 `.env`；并把 Key 读取改为**调用时取值**，顺序再错也不会退化；占位符 Key 视为未配置 |
| 2 | `seed_demo.js` 硬编码自己的库路径，且库里已有数据时调用 **`process.exit(0)`** —— 而它是被 `src/db.js` 用 `await import()` 加载的 | 一旦 `CAMPUS_DB` 指向别的库（或任何非默认库路径），**服务启动后立刻无声退出**，没有任何报错 | 路径改读 `CAMPUS_DB` 与 db.js 对齐；导出 `seedDemo(db)` 由调用方传库；只在**直接执行**时才自动运行，删除 `process.exit` |

## 🚀 本地运行

> **环境要求**：Node.js ≥ 22.5（数据库用的是 Node 内置的 `node:sqlite`，**无需安装任何原生编译工具**）。
> 全部依赖均为纯 JS 包，`npm install` 不触发 node-gyp 编译、不下载 GitHub release 资产，
> 国内网络环境下也能一次装成。

```bash
# 后端（端口 3001）
cd backend
npm install
cp .env.example .env   # 可选：填入 DeepSeek Key；不填则智能体走规则兜底
npm run seed           # 可选：灌入演示数据
npm run dev

# 前端（端口 5173，已配 /api 代理到 3001）
cd ../frontend
npm install
npm run dev
```

启动成功后，浏览器打开 `http://localhost:5173` 即可体验。

> ⚠️ **`localhost` 是你自己电脑上的地址** —— 本项目**没有部署线上 Demo**，
> 在 GitHub 页面里直接点这个链接是打不开的（它只会去连**点击者自己**的 5173 端口）。
> 想看效果请按上面的命令在本地跑起来（后端 + 前端两个终端，全程无需 API Key）。

### 为什么不用 better-sqlite3（一个真实的踩坑）

最初用的是 `better-sqlite3`，它是**原生 C++ 模块**：`npm install` 时先尝试下载 GitHub release
里的预编译包，下载失败就退回 `node-gyp` 源码编译。实测两条路在国内网络 + Windows 上都会断：

1. 预编译包托管在 `objects.githubusercontent.com`，该域名经常连不上（实测全部超时）；
2. 退回源码编译则要求本机装好 **Visual Studio "Desktop development with C++" 工具链**，
   没装就报 `gyp ERR! find VS` → `npm install` 整体失败 → `node server.js` 报
   `Cannot find package 'express'`，看起来像"代码坏了"，其实是依赖没装上。

改用 Node 内置的 `node:sqlite` 后，`npm install` 只装纯 JS 依赖（实测 <1s），
任何能跑 Node 22.5+ 的机器 clone 下来即可运行，不需要编译器、不需要访问 GitHub releases。

## 📁 结构

```
campus-mutual-aid/
├── backend/
│   ├── server.js          # Express 入口 + REST API（/api/chat、/api/recommend 等）
│   ├── src/
│   │   ├── agents.js      # ★ 5 个智能体（Router/Post/Audit/Search/Match）
│   │   ├── env.js         # ★ .env 引导模块（必须是 server.js 的第一个 import）
│   │   ├── llm.js         # 大模型统一封装（DeepSeek + 规则兜底）
│   │   ├── auth.js        # JWT 鉴权
│   │   └── db.js          # SQLite 初始化（users/posts/comments/dm 等表）
│   ├── seed_demo.js       # 幂等演示数据脚本（可执行，也可被 db.js 作为模块调用）
│   ├── test_agents.mjs    # ★ 5 个智能体行为测试 + 环境变量加载回归（48 项）
│   └── test_smoke.mjs     # 全链路冒烟测试
└── frontend/
    ├── vite.config.js     # /api 代理到后端
    └── src/
        ├── App.jsx        # 主入口/路由
        └── components/    # Plaza/PostDetail/Publish/Assistant/Messages/Profile 等
```

## 📝 License

MIT

---

**备注**：本项目为竞赛参赛作品（湖南省大学生计算机程序设计竞赛校内选拔），源码公开仅供学习参考。
数据库使用本地 SQLite，不含真实用户数据；密钥请自行在 `.env` 配置。
