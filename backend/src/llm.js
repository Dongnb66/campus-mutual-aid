// DeepSeek (OpenAI 兼容) 大模型封装
import process from 'process';

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

/**
 * 调用大模型对话接口
 * @param {Array} messages [{role:'system'|'user'|'assistant', content:string}]
 * @param {object} options temperature / response_format 等
 */
export async function chat(messages, options = {}) {
  if (!API_KEY) {
    throw new Error('未配置 DEEPSEEK_API_KEY，智能体将使用规则兜底');
  }
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
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
