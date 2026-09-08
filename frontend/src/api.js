// 统一 API 客户端：自动携带 JWT，集中错误处理
const BASE = '/api';
const TOKEN_KEY = 'campuswall_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
export function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }

async function req(method, url, body, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const t = getToken();
    if (t) headers['Authorization'] = `Bearer ${t}`;
  }
  const r = await fetch(BASE + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `请求失败(${r.status})`);
  return data;
}

export const api = {
  // 鉴权
  register: (b) => req('POST', '/auth/register', b, false),
  login: (b) => req('POST', '/auth/login', b, false),
  me: () => req('GET', '/auth/me'),

  // 用户
  getUser: (id) => req('GET', `/users/${id}`, null, false),
  findUser: (nickname) => req('GET', `/users/find?nickname=${encodeURIComponent(nickname)}`, null, false),

  // 帖子
  getPosts: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', '/posts' + (q ? '?' + q : ''));
  },
  getPost: (id) => req('GET', `/posts/${id}`),
  createPost: (b) => req('POST', '/posts', b),
  acceptPost: (id) => req('POST', `/posts/${id}/accept`),
  completePost: (id) => req('POST', `/posts/${id}/complete`),
  cancelPost: (id) => req('POST', `/posts/${id}/cancel`),
  commentPost: (id, content) => req('POST', `/posts/${id}/comment`, { content }),

  // 推荐
  recommend: () => req('GET', '/recommend'),

  // AI 对话
  chat: (message) => req('POST', '/chat', { message }),
  chatHistory: () => req('GET', '/chat/history'),

  // 私信
  dmList: () => req('GET', '/dm/list'),
  dmConversation: (userId) => req('GET', `/dm/${userId}`),
  sendDm: (receiver_id, content) => req('POST', '/dm', { receiver_id, content }),

  // 通知
  notifications: () => req('GET', '/notifications'),
  readNotification: (id) => req('POST', `/notifications/${id}/read`),
  readAllNotifications: () => req('POST', '/notifications/read-all'),

  // 平台运营统计（公开，无需登录）
  stats: () => req('GET', '/stats', null, false),
  topHelpers: () => req('GET', '/top-helpers', null, false),
};
