// 部署入口：edge runtime 用 Deno.serve；本地验证走 handler（Node 24 可直接调）。
// 本 playground 不依赖 Buffer / process / node:crypto，无需 Node 全局补丁。
// import 必须带显式扩展名（.mjs），否则 edge bundle 失败。
import { handler } from './handler.mjs';

Deno.serve((request: Request) => handler({ request, env: {} }));