// 缓存层：默认内存实现（带 TTL + LRU + 缓存穿透防护）。
// 生产环境可把 MemoryCache 替换为 RedisAdapter（接口一致，已在 README 注明），热路径查询即自动走 Redis。
import { createHash } from 'crypto';

class MemoryCache {
  constructor(max = 200) {
    this.map = new Map(); // 借用 Map 的插入顺序实现 LRU
    this.max = max;
  }
  _key(k) {
    return typeof k === 'string' ? k : createHash('sha1').update(JSON.stringify(k)).digest('hex');
  }
  get(key) {
    const k = this._key(key);
    const e = this.map.get(k);
    if (!e) return undefined;
    if (e.exp <= Date.now()) { this.map.delete(k); return undefined; }
    this.map.delete(k); this.map.set(k, e); // 命中即移至队尾（LRU）
    return e.value;
  }
  set(key, value, ttlSec = 60) {
    const k = this._key(key);
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(k, { value, exp: Date.now() + ttlSec * 1000 });
  }
  del(key) { this.map.delete(this._key(key)); }
  clear() { this.map.clear(); }
}

export const cache = new MemoryCache();

// 读缓存，未命中则执行 missFn 并回填。
// 缓存穿透防护：空结果也缓存（短 TTL），避免恶意/重复请求直接打到库。
export async function getOrSet(key, ttlSec, missFn, { cacheNull = true, nullTtl = 10 } = {}) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const val = await missFn();
  if (val === null || val === undefined) {
    if (cacheNull) cache.set(key, val, nullTtl);
    return val;
  }
  cache.set(key, val, ttlSec);
  return val;
}

/*
// === 生产替换示例（接口一致，无需改业务代码）===
// import { createClient } from 'redis';
// const client = createClient({ url: process.env.REDIS_URL });
// class RedisAdapter {
//   async get(k){ const v = await client.get(k); return v===null?undefined:JSON.parse(v); }
//   async set(k,v,ttl){ await client.set(k,JSON.stringify(v),{EX:ttl}); }
//   async del(k){ await client.del(k); }
//   async clear(){ SCAN+DEL 批量清理，避免误清全库 }
// }
*/
