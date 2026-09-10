// DeepSeek (OpenAI 兼容) 大模型封装
//
// 注意：配置读取一律放在**调用时**（getConfig / llmConfigured），
// 不要在模块顶层做 `const API_KEY = process.env.X` 快照 ——
// ESM 的 import 提升会让模块体先于 dotenv.config() 执行，
// 顶层快照会永久锁死成空字符串（历史 bug，见 src/env.js 注释）。
import { isPlaceholder } from './env.js';

function getConfig() {
  const rawKey = process.env.DEEPSEEK_API_KEY || '';
  return {
    apiKey: isPlaceholder(rawKey) ? '' : rawKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  };
}

/** 是否已配置可用的模型 Key（占位符视为未配置） */
export function llmConfigured() {
  return Boolean(getConfig().apiKey);
}

/**
 * 调用大模型对话接口
 * @param {Array} messages [{role:'system'|'user'|'assistant', content:string}]
 * @param {object} options temperature / response_format 等
 */
export async function chat(messages, options = {}) {
  const { apiKey, baseUrl, model } = getConfig();
  if (!apiKey) {
    throw new Error('未配置 DEEPSEEK_API_KEY，智能体将使用规则兜底');
  }
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        ...options,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`LLM error ${res.status}: ${err}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  } finally {
    clearTimeout(timer);
  }
}
