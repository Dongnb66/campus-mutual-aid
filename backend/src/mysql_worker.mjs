// MySQL 桥接 worker：在独立线程里跑 mysql2（异步），把结果写回 SharedArrayBuffer，
// 供主线程用 Atomics.wait 做**同步阻塞**读取——由此把异步的 mysql2 包装出
// node:sqlite 的同步 API 语义（prepare().get/all/run / exec），业务层零改动。
//
// 为什么能同步：node:sqlite 本身就是同步阻塞的，业务代码本来就运行在
// 「每个查询阻塞事件循环」的模型上；worker 桥只是把阻塞点从 V8 内部
// 换到了 Atomics.wait，IO 仍然发生在 worker 线程（不占主线程 CPU）。
import { parentPort, workerData } from 'worker_threads';
import mysql from 'mysql2/promise';

// 结果写回协议：worker 直接写共享内存（主线程此时阻塞在 Atomics.wait 上，
// postMessage 要等主线程回到事件循环才会被处理，走消息必死锁）。
// 布局：Int32[0]=状态(0等待/1完成) Int32[1]=错误 Int32[2]=payload字节数 → Uint8 payload
const IDX_STATE = 0, IDX_ERR = 1, IDX_LEN = 2, PAYLOAD = 12; // Int32[2] 占字节 8-11，payload 从 12 起避免重叠
const i32 = new Int32Array(workerData.sab);
const u8 = new Uint8Array(workerData.sab);

function writeResult(out) {
  const isErr = out && typeof out === 'object' && 'error' in out ? 1 : 0;
  const bytes = Buffer.from(JSON.stringify(out), 'utf8');
  if (bytes.length > u8.length - PAYLOAD) {
    const err = Buffer.from(JSON.stringify({ error: 'result too large for sync bridge' }), 'utf8');
    u8.set(err, PAYLOAD);
    i32[IDX_LEN] = err.length;
    i32[IDX_ERR] = 1;
  } else {
    u8.set(bytes, PAYLOAD);
    i32[IDX_LEN] = bytes.length;
    i32[IDX_ERR] = isErr;
  }
  Atomics.store(i32, IDX_STATE, 1);
  Atomics.notify(i32, IDX_STATE);
}

let pool;

async function ensureDatabase(uri) {
  // 库不存在时先建库（utf8mb4，emoji 头像/中文内容都需要）
  const u = new URL(uri);
  const dbName = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const admin = await mysql.createConnection({
    host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username || 'root'),
    password: decodeURIComponent(u.password || ''), multipleStatements: false,
  });
  await admin.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await admin.end();
  return dbName;
}

async function handle({ op, sql, params }) {
  let out;
  try {
    // 统一走带参数的 query（客户端占位符转义）；结果形态决定返回值：
    // SELECT → {rows}；INSERT/UPDATE/DELETE → {changes, lastInsertRowid}
    const [res] = await pool.query(sql, params || []);
    out = Array.isArray(res) && res.length && (res[0] instanceof Array || res[0]?.affectedRows === undefined)
      ? { rows: Array.isArray(res[0]) ? res.flat() : res } // 多语句（建表脚本）结果
      : (Array.isArray(res) ? { rows: res } : { changes: res.affectedRows, lastInsertRowid: res.insertId });
  } catch (e) {
    out = { error: `[mysql] ${e.message}` };
  }
  writeResult(out);
}

(async () => {
  const uri = process.env.MYSQL_URL;
  try {
    await ensureDatabase(uri);
    pool = mysql.createPool({
      uri,
      connectionLimit: 8,
      multipleStatements: true, // 兼容 sqlite 风格的一次 exec 多语句（建表脚本）
      dateStrings: true,        // DATETIME 返回字符串，与 node:sqlite 行为一致
      charset: 'utf8mb4_general_ci',
    });
    const [ping] = await pool.query('SELECT 1');
    if (!ping) throw new Error('pool ping failed');
    parentPort.postMessage({ ready: true }); // 握手走消息即可（主线程此刻未阻塞）
    parentPort.on('message', (m) => { handle(m); });
  } catch (e) {
    parentPort.postMessage({ ready: false, error: e.message });
  }
})();
