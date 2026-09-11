// 同步 MySQL 桥（主线程侧）：把异步的 mysql2 包装成 node:sqlite 的同步 API。
//
// 用法（在 src/db.js 里按 DB_DRIVER 选择引擎）：
//   const db = await createSyncMySQL(process.env.MYSQL_URL);
//   db.exec(sql) / db.prepare(sql).get(...params).all(...).run(...)
//
// 通信机制：主线程 Atomics.wait 阻塞等待；worker 把结果 JSON 写入 SharedArrayBuffer
// 后 Atomics.notify 唤醒。请求方向走 postMessage（无需同步等待）。
// 这与 node:sqlite 的行为模型一致：查询期间阻塞，但 IO 在 worker 线程执行。
import { Worker } from 'worker_threads';

// SAB 布局：Int32[0]=状态(0等待/1完成) Int32[1]=错误标记 Int32[2]=payload字节数 → Uint8 payload
const SAB_BYTES = 32 * 1024 * 1024; // 32MB 结果上限（本应用最大结果集 ~ 数百 KB）
const IDX_STATE = 0, IDX_ERR = 1, IDX_LEN = 2, PAYLOAD = 12; // Int32[2] 占字节 8-11，payload 从 12 起避免重叠

// SQLite → MySQL 方言翻译（仅覆盖本项目实际用到的差异点）
function translate(sql) {
  let s = sql;
  const ti = s.match(/^PRAGMA\s+table_info\((\w+)\)/i);
  if (ti) {
    // 表结构探测 → information_schema 等价查询
    s = `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS ` +
        `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${ti[1]}' ORDER BY ORDINAL_POSITION`;
    return { sql: s, isSelect: true };
  }
  const isSelect = /^\s*(SELECT|WITH)/i.test(s);
  if (/^BEGIN\s+IMMEDIATE/i.test(s)) s = 'START TRANSACTION'; // sqlite 的写锁开事务
  s = s.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'REPLACE INTO'); // sqlite 语法 → MySQL 等价
  s = s.replace(/PRAGMA\s+\w+\s*=\s*[^;]+;?/gi, ''); // journal_mode 等对 MySQL 无意义，安全剔除
  return { sql: s, isSelect };
}

class SyncBridge {
  constructor(url) {
    this.sab = new SharedArrayBuffer(SAB_BYTES);
    this.i32 = new Int32Array(this.sab);
    this.u8 = new Uint8Array(this.sab);
    this._seq = 0;
    this._ready = null;

    // SAB 通过 workerData 共享给 worker：查询结果由 worker 直接写入并 notify 唤醒。
    // （结果绝不能走 postMessage——主线程阻塞在 Atomics.wait 上，消息永远不会被处理。）
    this.worker = new Worker(new URL('./mysql_worker.mjs', import.meta.url), {
      workerData: { sab: this.sab },
      env: { ...process.env, MYSQL_URL: url },
    });
    this.worker.on('message', (m) => {
      if (m && 'ready' in m) { // 启动握手（此时主线程尚在 await，未阻塞，正常走消息队列）
        this._ready = m.ready ? true : new Error(m.error || 'mysql worker init failed');
        return;
      }
    });
    this.worker.on('error', (e) => { this._ready = this._ready ?? e; });

    function out_is_error(out) { return out && typeof out === 'object' && 'error' in out ? 1 : 0; }
    void out_is_error;
  }

  /** 等待 worker 就绪（抛错 = 连不上，调用方据此降级 SQLite） */
  async waitReady() {
    const t0 = Date.now();
    while (this._ready === null) {
      if (Date.now() - t0 > 10000) throw new Error('mysql worker ready 超时');
      await new Promise((r) => setTimeout(r, 25));
    }
    if (this._ready instanceof Error) throw this._ready;
    if (this._ready !== true) throw new Error(String(this._ready));
  }

  /** 同步执行一次查询；SELECT 返回 {rows}，写操作返回 {changes,lastInsertRowid}；失败抛错 */
  call(sql, params, isSelect) {
    const t = translate(sql);
    Atomics.store(this.i32, IDX_STATE, 0);
    this.worker.postMessage({ id: ++this._seq, op: (isSelect ?? t.isSelect) ? 'query' : 'exec', sql: t.sql, params: params || [] });
    Atomics.wait(this.i32, IDX_STATE, 0); // 阻塞直到 worker 写完结果
    const len = this.i32[IDX_LEN];
    const isErr = this.i32[IDX_ERR] === 1;
    const json = Buffer.from(this.u8.subarray(PAYLOAD, PAYLOAD + len)).toString('utf8');
    const out = JSON.parse(json);
    if (isErr || out.error) throw new Error(out.error || 'mysql query failed');
    return out;
  }
}

/** 创建具备 node:sqlite 同步 API 的 MySQL 引擎；连接失败抛错（调用方可降级 SQLite） */
export async function createSyncMySQL(url) {
  const bridge = new SyncBridge(url);
  await bridge.waitReady();
  return {
    driver: 'mysql',
    exec(sql) { bridge.call(sql, []); },
    prepare(sql) {
      const isSelect = /^\s*(SELECT|WITH)/i.test(sql) || /^PRAGMA\s+table_info/i.test(sql);
      return {
        get: (...params) => {
          const out = bridge.call(sql, params, isSelect);
          return out.rows && out.rows.length ? out.rows[0] : undefined;
        },
        all: (...params) => {
          const out = bridge.call(sql, params, isSelect);
          return out.rows || [];
        },
        run: (...params) => {
          const out = bridge.call(sql, params, isSelect);
          return { changes: out.changes ?? 0, lastInsertRowid: out.lastInsertRowid };
        },
      };
    },
  };
}
