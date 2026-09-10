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
- **后端**：Node.js ≥22 · Express · better-sqlite3（`backend/`）
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

## ✅ 冒烟测试

```bash
cd backend
npm install
node test_smoke.mjs   # 一键验证 双token / RBAC / 原子接单 / 缓存 四项升级
```

## 🚀 本地运行

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

打开 http://localhost:5173 即可体验。

## 📁 结构

```
campus-mutual-aid/
├── backend/
│   ├── server.js          # Express 入口 + REST API（/api/chat、/api/recommend 等）
│   ├── src/
│   │   ├── agents.js      # ★ 5 个智能体（Router/Post/Audit/Search/Match）
│   │   ├── llm.js         # 大模型统一封装（DeepSeek + 规则兜底）
│   │   ├── auth.js        # JWT 鉴权
│   │   └── db.js          # SQLite 初始化（users/posts/comments/dm 等表）
│   └── seed_demo.js       # 幂等演示数据脚本
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
