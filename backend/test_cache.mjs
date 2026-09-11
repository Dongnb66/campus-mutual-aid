// 缓存层测试：内存后端必测；Redis 后端在 REDIS_URL 可达时实测，不可达则跳过。
// 运行：node test_cache.mjs            （不配 REDIS_URL → 只测内存）
//       REDIS_URL=redis://127.0.0.1:6379 node test_cache.mjs   （真 Redis 实测）
import assert from 'node:assert/strict';
import { cache, getOrSet, initCache, cacheBackend } from './src/cache.js';

let passed = 0;
function ok(name) { passed++; console.log(`  ok ${passed} - ${name}`); }

// ---------- 内存后端（默认） ----------
{
  const backend = await initCache();
  assert.equal(backend, 'memory');
  assert.equal(cacheBackend, 'memory');

  // set/get/过期
  await cache.set('k1', { v: 1 }, 60);
  assert.deepEqual(await cache.get('k1'), { v: 1 });
  ok('内存 set/get 往返');

  await cache.set('k-exp', 1, 1);
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(await cache.get('k-exp'), undefined);
  ok('内存 TTL 过期');

  // getOrSet：命中不执行 missFn
  let calls = 0;
  const miss = () => { calls++; return { data: 42 }; };
  assert.deepEqual(await getOrSet('g1', 60, miss), { data: 42 });
  assert.deepEqual(await getOrSet('g1', 60, miss), { data: 42 });
  assert.equal(calls, 1);
  ok('getOrSet 未命中回填、命中不再回源');

  // 穿透防护：空结果短 TTL 也缓存
  let nullCalls = 0;
  const nullMiss = () => { nullCalls++; return null; };
  await getOrSet('g-null', 60, nullMiss);
  await getOrSet('g-null', 60, nullMiss);
  assert.equal(nullCalls, 1);
  ok('空结果也缓存（穿透防护）');

  // missFn 抛错要向上抛（业务错误不能被缓存吞掉）
  await assert.rejects(() => getOrSet('g-err', 60, () => { throw new Error('db down'); }), /db down/);
  ok('missFn 异常向上传播');

  // 后端故障容错：cache.set 抛错不影响业务返回
  await cache.set('broken', 1, 60);
  const origSet = cache.set.bind(cache);
  cache.set = () => { throw new Error('redis down mid-run'); };
  assert.equal(await getOrSet('g-broken', 60, () => 'value'), 'value');
  cache.set = origSet;
  ok('后端 set 抛错不拖垮业务');

  await cache.clear();
  assert.equal(await cache.get('k1'), undefined);
  ok('clear 清空');
}

// ---------- Redis 后端（真连接实测） ----------
{
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const backend = await initCache();
  if (backend !== 'redis') {
    console.log('  SKIP - Redis 不可达，跳过真 Redis 用例（降级逻辑本身已验证）');
  } else {
    assert.equal(cacheBackend, 'redis');
    console.log(`  connected - ${process.env.REDIS_URL}`);

    await cache.clear();
    await cache.set('rk1', { v: 'redis' }, 60);
    assert.deepEqual(await cache.get('rk1'), { v: 'redis' });
    ok('Redis set/get 往返（真实服务端）');

    await cache.set('rk-exp', 1, 1);
    await new Promise((r) => setTimeout(r, 1300));
    assert.equal(await cache.get('rk-exp'), undefined);
    ok('Redis TTL 过期（EX 真过期）');

    let calls = 0;
    const val = await getOrSet('rk-g', 60, () => { calls++; return 'from-db'; });
    assert.equal(val, 'from-db');
    await getOrSet('rk-g', 60, () => { calls++; return 'from-db'; });
    assert.equal(calls, 1);
    ok('Redis 后端 getOrSet 二次命中不回源');

    // 键真的落在 Redis 里，且带应用前缀
    const { createClient } = await import('redis');
    const probe = createClient({ url: process.env.REDIS_URL });
    await probe.connect();
    const keys = await probe.keys('cma:*');
    assert.ok(keys.includes('cma:rk-g'), `应存在 cma:rk-g，实际：${keys.join(',')}`);
    await probe.disconnect();
    ok('键带 cma: 前缀真实落库');

    // clear 只清本应用前缀：写入一个非本应用键，clear 后仍在
    const probe2 = createClient({ url: process.env.REDIS_URL });
    await probe2.connect();
    await probe2.set('other-app:key', 'keep');
    await cache.clear();
    assert.equal(await probe2.get('other-app:key'), 'keep');
    assert.equal(await cache.get('rk1'), undefined);
    await probe2.del('other-app:key');
    await probe2.disconnect();
    ok('clear 按前缀清理，不误删共享库其它键');

    // 非 string key → sha1 哈希
    await cache.set({ a: 1 }, 'obj-key-val', 60);
    assert.equal(await cache.get({ a: 1 }), 'obj-key-val');
    ok('对象 key 稳定哈希往返');
  }
}

console.log(`\n缓存测试通过：${passed} 项（backend=${cacheBackend}）`);
process.exit(0); // Redis 连接会保持事件循环存活，显式退出
