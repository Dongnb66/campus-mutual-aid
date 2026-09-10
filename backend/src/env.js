// env.js —— 环境变量引导模块
//
// 为什么必须有这个文件：
// ESM 的 import 会被提升到模块体之前执行。原写法把 dotenv.config() 写在
// server.js 的 import 之后，于是 src/llm.js、src/auth.js 在「模块加载阶段」
// 读 process.env 时，.env 还没被加载 —— 结果就是：
//   .env.example 里写着「复制为 .env 并填写你的 DeepSeek API Key」，
//   但配了 Key 也永远读不到，5 个智能体静默降级成规则兜底。
//
// 修法有两道（缺一不可）：
//   1. 本模块作为 server.js 的**第一个 import**，保证 .env 早于其它模块加载；
//   2. src/llm.js 的 Key 读取改成「调用时取值」，不再在模块加载阶段快照 ——
//      这样即使导入顺序被改动，行为也不会再退化。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_ENV_FILE =
  process.env.CAMPUS_ENV_FILE || path.join(__dirname, '..', '.env');

/** 解析 .env 文本 → 键值对（不做任何写入，便于单测）。解析交给 dotenv，避免自造轮子 */
export function parseEnvFile(text) {
  return dotenv.parse(String(text || ''));
}

/**
 * 把 .env 加载进 process.env。已存在的键默认不覆盖（与 dotenv / node --env-file 一致），
 * 避免测试或部署时用 shell 环境变量覆盖 .env。
 * @returns {string[]} 实际写入的键名
 */
export function loadEnvFile(filePath = DEFAULT_ENV_FILE, { override = false } = {}) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const parsed = parseEnvFile(fs.readFileSync(filePath, 'utf8'));
  const applied = [];
  for (const [key, val] of Object.entries(parsed)) {
    if (override || !(key in process.env)) {
      process.env[key] = val;
      applied.push(key);
    }
  }
  return applied;
}

/** 占位符（.env.example 直接复制没改）不应被当成有效配置 */
export function isPlaceholder(v) {
  return /请填写|your[_-]?key|change[_-]?me|please[_-]?change|x{6,}/i.test(String(v || ''));
}

// 副作用：被导入即加载（server.js 的第一个 import）
loadEnvFile();
