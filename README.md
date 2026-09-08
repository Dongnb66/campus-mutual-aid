# 校园互助平台 · 多智能体增强版（Campus Mutual-Aid · Multi-Agent）

一个**用多智能体编排解决"校园互助匹配效率低、内容难管控"问题**的全栈平台。
核心业务是一条**多智能体协作流水线**：需求理解 → 发帖引导 → 内容审核 → 检索 → 智能撮合，
各环节由独立智能体承担、可单独调试与替换；同时用 **RAG 语义检索**做"需求–资源"精准匹配，
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
| **检索 Search** | `searchPosts` | 从查询提取检索关键词，走 RAG 语义检索找匹配帖子 |
| **撮合 Match** | `matchPosts` | 按信用分/完成率/活跃度做"需求–服务者"智能撮合推荐 |

关键设计：**每个智能体都支持两套实现——配置了模型 Key 走大模型（DeepSeek 等），未配置自动回退"规则兜底"**，
保证 `clone` 下来**无 Key 也能端到端跑通演示**，同时兼顾成本与可用性。

## 🧱 技术栈

- **前端**：React 18 · Vite 5（`frontend/`）
- **后端**：Node.js ≥22 · Express · better-sqlite3（`backend/`）
- **智能体/大模型**：`llm.js` 统一封装，支持 DeepSeek（默认）/ 任意 OpenAI 兼容协议，可用 `.env` 切换
- **防幻觉**：无检索匹配即走规则兜底/拒答，不让模型凭空编造

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
