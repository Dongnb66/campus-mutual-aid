// 缓存层：双后端——默认内存实现（TTL + LRU + 缓存穿透防护），
// 配置 REDIS_URL 时自动切换为**真 Redis** 适配器（接口一致，业务代码零改动）。
//
// 设计要点（面试可讲）：
// 1. 同一接口两个实现：getOrSet 不感知后端，切换只动配置不动代码；
// 2. 启动时探测：REDIS_URL 连不上（超时 / 服务未起）→ 自动降级内存并打日志，
//    **缓存组件故障不允许拖垮业务主流程**；
// 3. 运行期容错：Redis 中途挂掉，get/set 抛错被 getOrSet 吞掉 → 当作未命中处理，
//    请求照常回源数据库，业务无感；
// 4. 穿透防护两种后端都有：空结果也缓存（短 TTL），防止恶意/重复请求打穿到库；
// 5. clear() 用 SCAN 按前缀删除而不是 FLUSHDB——共享 Redis 时不能误清别人的库。
import { createHash } from 'crypto';

const KEY_PREFIX = 'cma:'; // campus-mutual-aid 的 key 前缀，便于 SCAN 定界与排查

function rawKey(k) {
  return typeof k === 'string' ? k : createHash('sha1').update(JSON.stringify(k)).digest('hex');
}

class MemoryCache {
  constructor(max = 200) {
    this.map = new Map(); // 借用 Map 的插入顺序实现 LRU
    this.max = max;
  }
  get(key) {
    const k = KEY_PREFIX + rawKey(key);
    const e = this.map.get(k);
    if (!e) return undefined;
    if (e.exp <= Date.now()) { this.map.delete(k); return undefined; }
    this.map.delete(k); this.map.set(k, e); // 命中即移至队尾（LRU）
    return e.value;
  }
  set(key, value, ttlSec = 60) {
    const k = KEY_PREFIX + rawKey(key);
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(k, { value, exp: Date.now() + ttlSec * 1000 });
  }
  del(key) { this.map.delete(KEY_PREFIX + rawKey(key)); }
  clear() { this.map.clear(); }
}

// 真 Redis 适配器：与 MemoryCache 接口一致（方法为 async）
class RedisCache {
  constructor(client) {
    this.client = client;
  }
  async get(key) {
    const v = await this.client.get(KEY_PREFIX + rawKey(key));
    return v === null ? undefined : JSON.parse(v);
  }
  async set(key, value, ttlSec = 60) {
    await this.client.set(KEY_PREFIX + rawKey(key), JSON.stringify(value), { EX: ttlSec });
  }
  async del(key) {
    await this.client.del(KEY_PREFIX + rawKey(key));
  }
  async clear() { // SCAN 按前缀批量删除，绝不 FLUSHDB
    let cursor = 0;
    do {
      const { cursor: next, keys } = await this.client.scan(cursor, { MATCH: KEY_PREFIX + '*', COUNT: 200 });
      if (keys.length) await this.client.del(keys);
      cursor = next;
    } while (cursor !== 0);
  }
}

// 当前缓存后端：'memory' | 'redis'（initCache 后定型，/api/health 会暴露）
export let cacheBackend = 'memory';
// 注意：ESM 的 let 具有活绑定——initCache() 重新赋值后，所有 import 方拿到的都是新实例
export let cache = new MemoryCache();

/**
 * 启动时初始化缓存后端：配置了 REDIS_URL 就连真 Redis，失败自动降级内存。
 * 在 server.js 的启动流程里 await 调用（早于 app.listen）。
 */
export async function initCache() {
  const url = process.env.REDIS_URL;
  if (!url) return cacheBackend;
  try {
    const { createClient } = await import('redis');
    const client = createClient({ url, socket: { connectTimeout: 2000, reconnectStrategy: false } });
    client.on('error', (e) => console.warn(`[cache] Redis 运行期错误：${e.message}`));
    await client.connect();
    await client.ping();
    cache = new RedisCache(client);
    cacheBackend = 'redis';
    console.log(`[cache] 缓存后端 = Redis（${url}）`);
  } catch (err) {
    cache = new MemoryCache();
    cacheBackend = 'memory';
    console.warn(`[cache] Redis 不可用（${err.message}），已降级内存缓存`);
  }
  return cacheBackend;
}

// 读缓存，未命中则执行 missFn 并回填。
// 缓存穿透防护：空结果也缓存（短 TTL），避免恶意/重复请求直接打到库。
// 运行期容错：后端抛错（如 Redis 中途掉线）→ 当作未命中，业务照常回源。
export async function getOrSet(key, ttlSec, missFn, { cacheNull = true, nullTtl = 10 } = {}) {
  let hit;
  try {
    hit = await cache.get(key);
  } catch (err) {
    console.warn(`[cache] get 失败（按未命中处理）：${err.message}`);
  }
  if (hit !== undefined) return hit;
  const val = await missFn();
  try {
    if (val === null || val === undefined) {
      if (cacheNull) await cache.set(key, val, nullTtl);
    } else {
      await cache.set(key, val, ttlSec);
    }
  } catch (err) {
    console.warn(`[cache] set 失败（不影响业务）：${err.message}`);
  }
  return val;
}
