// build-playground.mjs —— 把仓库内 playground/ 增量拷贝到会话工作目录的 campus-out/，
// 并做发布前自检守卫。不触碰本地完整版源码与原有测试。
// 用法：node scripts/build-playground.mjs <输出目录> [--static]
//   默认：web/ + functions/（边缘函数版，需后端配额）
//   --static：后端配额满时的兜底——functions 的 .mjs 算法模块拷进 web/lib/，
//             由 index.html 动态加载在浏览器内执行同一份 handler（无状态，不写公开库）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2];
const STATIC = process.argv.includes('--static');
if (!outDir) { console.error('用法: node scripts/build-playground.mjs <输出目录> [--static]'); process.exit(2); }

const srcWeb = path.join(repoRoot, 'playground', 'web');
const srcFn = path.join(repoRoot, 'playground', 'functions');
for (const d of [srcWeb, srcFn]) {
  if (!fs.existsSync(d)) { console.error('缺少目录：' + d); process.exit(1); }
}

// ---- 拷贝（functions 排除测试文件；tests/ 不部署）----
function copyDir(src, dst, filter) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (filter && !filter(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d, filter);
    else fs.copyFileSync(s, d);
  }
}
fs.rmSync(outDir, { recursive: true, force: true });
copyDir(srcWeb, path.join(outDir, 'web'));
if (STATIC) {
  copyDir(srcFn, path.join(outDir, 'web', 'lib'), (name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'));
  // 静态模式标记：index.html 据此把 /api/* 路由到浏览器内的同一份 handler
  const idx = path.join(outDir, 'web', 'index.html');
  fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace('name="cma-mode" content="edge"', 'name="cma-mode" content="static"'));
} else {
  copyDir(srcFn, path.join(outDir, 'functions'), (name) => !name.endsWith('.test.mjs'));
}

// ---- 自检守卫 ----
const FORBIDDEN = [
  'pt-online-schema-change', // 内容扫描确定性误报源
  '127.0.0.1',
  'localhost',
  '杨运栋',                    // 真实姓名不进公网产物
  'DEEPSEEK_API_KEY',         // 任何真实 Key 痕迹都不允许
  'sk-',
];
const problems = [];
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
})(outDir);

for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const rel = path.relative(outDir, f);
  for (const bad of FORBIDDEN) {
    if (text.includes(bad)) problems.push(`${rel} 含违禁字面量「${bad}」`);
  }
  if (f.endsWith('.ts') || f.endsWith('.mjs')) {
    // edge bundle 要求显式扩展名；副作用 import 也不例外
    const re = /(?:import|export)\s+(?:[\s\S]*?from\s+)?['"](\.[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(text))) {
      if (!/\.(mjs|ts)$/.test(m[1])) problems.push(`${rel} 相对 import 缺显式扩展名：${m[1]}`);
    }
    if (/[^.\w]require\(/.test(text)) problems.push(`${rel} 含 CommonJS require（edge 不支持）`);
    if (/\bBuffer\b|\bprocess\./.test(text) && !f.endsWith('index.ts')) problems.push(`${rel} 用到 Buffer/process（edge 无此全局，需补丁或移除）`);
  }
}
if (!fs.existsSync(path.join(outDir, 'web', 'index.html'))) problems.push('缺 web/index.html');
if (STATIC) {
  for (const m of ['handler.mjs', 'core.mjs', 'seed.mjs']) {
    if (!fs.existsSync(path.join(outDir, 'web', 'lib', m))) problems.push('静态模式缺 web/lib/' + m);
  }
  if (!fs.readFileSync(path.join(outDir, 'web', 'index.html'), 'utf8').includes('name="cma-mode" content="static"')) problems.push('静态模式标记未写入 index.html');
} else if (!fs.existsSync(path.join(outDir, 'functions', 'index.ts'))) {
  problems.push('缺 functions/index.ts');
}

if (problems.length) {
  console.error('自检失败：\n' + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log(`构建完成：${files.length} 个文件 → ${outDir}`);
console.log('自检通过：无违禁字面量 / import 均带显式扩展名 / 无 Node 全局依赖');
for (const f of files) console.log('  ' + path.relative(outDir, f));