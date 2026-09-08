/**
 * 员工棒球卡系统 - 后端服务
 * 零依赖 Node.js HTTP 服务，数据存本地 JSON 文件
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3817;
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PID_FILE = path.join(__dirname, '.worker-card.pid');

// ---------- 数据层 ----------
const FILES = {
  employees: path.join(DATA_DIR, 'employees.json'),
  salary: path.join(DATA_DIR, 'salary.json'),
  travel: path.join(DATA_DIR, 'travel.json'),
  equipment: path.join(DATA_DIR, 'equipment.json'),
  assessments: path.join(DATA_DIR, 'assessments.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
};

const EXAMPLE_FILES = {
  employees: path.join(DATA_DIR, 'employees.example.json'),
  salary: path.join(DATA_DIR, 'salary.example.json'),
  travel: path.join(DATA_DIR, 'travel.example.json'),
  equipment: path.join(DATA_DIR, 'equipment.example.json'),
  assessments: path.join(DATA_DIR, 'assessments.example.json'),
};

const COMPETENCY_IDS = new Set([
  'ownership', 'openness', 'judgment', 'learning', 'execution', 'collaboration',
]);

/** 默认薪酬规则：总薪酬拆 70% 基本工资 + 30% 绩效；日薪 = 基本工资 / 26；时薪 = 日薪 / 8 */
const DEFAULT_SETTINGS = {
  baseRatio: 0.7,   // 基本工资占月薪总额比例
  daysPerMonth: 26, // 每月计薪天数（事假按天扣）
  hoursPerDay: 8,   // 每日工时（迟到/早退按小时扣）
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(FILES.settings, 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function load(name) {
  try {
    return JSON.parse(fs.readFileSync(FILES[name], 'utf8'));
  } catch {
    return [];
  }
}

function save(name, list) {
  fs.writeFileSync(FILES[name], JSON.stringify(list, null, 2), 'utf8');
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * 薪酬自动计算：
 *   基本工资 = 总额 × baseRatio，绩效基数 = 总额 × (1-baseRatio)
 *   绩效双模式：perfMode='amount' 直接定额（如发 2500）；'pct' 按基数百分比（如 90% = 基数×0.9）
 *   日薪     = 基本工资 / daysPerMonth（事假按天扣）
 *   时薪     = 日薪 / hoursPerDay（迟到/早退按小时扣）
 *   实发     = 基本 + 绩效 + 奖金 − 扣款
 */
function computeSalary(input, st) {
  const total = round2(input.total);
  const base = round2(total * st.baseRatio);
  const stdMerit = round2(total * (1 - st.baseRatio)); // 绩效基数（100% 时）
  const bonus = round2(input.bonus);
  const perfMode = input.perfMode === 'amount' ? 'amount' : 'pct';
  let perfValue, perfPct, merit;
  if (perfMode === 'amount') {
    perfValue = round2(input.perfValue);
    merit = perfValue;
    perfPct = stdMerit > 0 ? round2(perfValue / stdMerit * 100) : null; // 折算系数，仅展示用
  } else {
    perfValue = (input.perfValue === undefined || input.perfValue === '') ? 100 : Number(input.perfValue);
    perfPct = perfValue;
    merit = round2(stdMerit * perfValue / 100);
  }
  const leaveDays = Number(input.leaveDays) || 0;
  const lateHours = Number(input.lateHours) || 0;
  const earlyHours = Number(input.earlyHours) || 0;
  const daily = base / st.daysPerMonth;
  const hourly = daily / st.hoursPerDay;
  const leaveDeduct = round2(leaveDays * daily);
  const lateDeduct = round2((lateHours + earlyHours) * hourly);
  const deduct = round2(leaveDeduct + lateDeduct);
  const net = round2(base + merit + bonus - deduct);
  return { total, base, stdMerit, perfMode, perfValue, perfPct, merit, bonus, leaveDays, lateHours, earlyHours, leaveDeduct, lateDeduct, deduct, net };
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- 工具 ----------
function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(PUBLIC_DIR, p);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  });
}

// ---------- API ----------
async function handleApi(req, res, pathname) {
  const method = req.method;

  // 员工 CRUD
  if (pathname === '/api/employees') {
    if (method === 'GET') return send(res, 200, load('employees'));
    if (method === 'POST') {
      const body = await readBody(req);
      const emp = {
        id: uid(),
        name: (body.name || '').trim(),
        department: (body.department || '未分配').trim(),
        position: (body.position || '').trim(),
        joinDate: body.joinDate || '',
        monthlyBase: Number(body.monthlyBase) || 0, // 默认月薪，录入薪酬时可自动带出
        photo: body.photo || '', // dataURL 或留空
        roleSummary: String(body.roleSummary || '').trim(),
        skills: Array.isArray(body.skills)
          ? body.skills.map((x) => String(x).trim()).filter(Boolean).slice(0, 12)
          : [],
        note: body.note || '',
        createdAt: new Date().toISOString(),
      };
      if (!emp.name) return send(res, 400, { error: '姓名必填' });
      const list = load('employees');
      list.push(emp);
      save('employees', list);
      return send(res, 201, emp);
    }
  }

  let m = pathname.match(/^\/api\/employees\/([^/]+)$/);
  if (m) {
    const list = load('employees');
    const idx = list.findIndex((e) => e.id === m[1]);
    if (idx < 0) return send(res, 404, { error: '员工不存在' });
    if (method === 'PUT') {
      const body = await readBody(req);
      const old = list[idx];
      list[idx] = {
        ...old,
        name: body.name !== undefined ? String(body.name).trim() : old.name,
        department: body.department !== undefined ? String(body.department).trim() : old.department,
        position: body.position !== undefined ? String(body.position).trim() : old.position,
        joinDate: body.joinDate !== undefined ? body.joinDate : old.joinDate,
        monthlyBase: body.monthlyBase !== undefined ? Number(body.monthlyBase) || 0 : old.monthlyBase,
        photo: body.photo !== undefined ? body.photo : old.photo,
        roleSummary: body.roleSummary !== undefined ? String(body.roleSummary).trim() : (old.roleSummary || ''),
        skills: body.skills !== undefined && Array.isArray(body.skills)
          ? body.skills.map((x) => String(x).trim()).filter(Boolean).slice(0, 12)
          : (old.skills || []),
        note: body.note !== undefined ? body.note : old.note,
      };
      if (!list[idx].name) return send(res, 400, { error: '姓名必填' });
      save('employees', list);
      return send(res, 200, list[idx]);
    }
    if (method === 'DELETE') {
      list.splice(idx, 1);
      save('employees', list);
      // 级联删除薪酬、差旅与能力观察记录
      const salary = load('salary').filter((r) => r.empId !== m[1]);
      const travel = load('travel').filter((r) => r.empId !== m[1]);
      const assessments = load('assessments').filter((r) => r.empId !== m[1]);
      save('salary', salary);
      save('travel', travel);
      save('assessments', assessments);
      return send(res, 200, { ok: true });
    }
  }

  // 人才棒球卡观察记录：保留每一次评分及其证据，由前端汇总画像
  if (pathname === '/api/assessments') {
    if (method === 'GET') return send(res, 200, load('assessments'));
    if (method === 'POST') {
      const body = await readBody(req);
      const employees = load('employees');
      const score = Number(body.score);
      const evidence = String(body.evidence || '').trim();
      const dimension = String(body.dimension || '');
      if (!employees.some((e) => e.id === body.empId)) return send(res, 400, { error: '员工不存在' });
      if (!COMPETENCY_IDS.has(dimension)) return send(res, 400, { error: '能力维度无效' });
      if (!Number.isInteger(score) || score < 1 || score > 5) return send(res, 400, { error: '评分需为 1～5 的整数' });
      if (evidence.length < 6) return send(res, 400, { error: '请填写至少 6 个字的具体事实或工作结果' });
      const rec = {
        id: uid(),
        empId: body.empId,
        date: /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : new Date().toISOString().slice(0, 10),
        dimension,
        score,
        source: ['manager', 'self', 'peer', 'result'].includes(body.source) ? body.source : 'manager',
        observer: String(body.observer || '管理员').trim() || '管理员',
        evidence,
        createdAt: new Date().toISOString(),
      };
      const list = load('assessments');
      list.push(rec);
      save('assessments', list);
      return send(res, 201, rec);
    }
  }

  m = pathname.match(/^\/api\/assessments\/([^/]+)$/);
  if (m && method === 'DELETE') {
    const list = load('assessments');
    const i = list.findIndex((r) => r.id === m[1]);
    if (i < 0) return send(res, 404, { error: '观察记录不存在' });
    list.splice(i, 1);
    save('assessments', list);
    return send(res, 200, { ok: true });
  }

  // 薪酬规则设置
  if (pathname === '/api/settings') {
    if (method === 'GET') return send(res, 200, loadSettings());
    if (method === 'PUT') {
      const body = await readBody(req);
      const cur = loadSettings();
      const next = {
        baseRatio: body.baseRatio !== undefined
          ? Math.min(0.9, Math.max(0.1, Number(body.baseRatio) || cur.baseRatio))
          : cur.baseRatio,
        daysPerMonth: body.daysPerMonth !== undefined
          ? Math.min(31, Math.max(1, Number(body.daysPerMonth) || cur.daysPerMonth))
          : cur.daysPerMonth,
        hoursPerDay: body.hoursPerDay !== undefined
          ? Math.min(24, Math.max(1, Number(body.hoursPerDay) || cur.hoursPerDay))
          : cur.hoursPerDay,
      };
      fs.writeFileSync(FILES.settings, JSON.stringify(next, null, 2), 'utf8');
      return send(res, 200, next);
    }
  }

  // 薪酬记录 CRUD
  if (pathname === '/api/salary') {
    if (method === 'GET') return send(res, 200, load('salary'));
    if (method === 'POST') {
      const body = await readBody(req);
      if (!body.empId) return send(res, 400, { error: '缺少员工' });
      if (Number(body.bonus) > 0 && !String(body.note || '').trim()) {
        return send(res, 400, { error: '填写奖金后需补充奖金发放原因' });
      }
      const st = loadSettings();
      const rec = {
        id: uid(),
        empId: body.empId,
        year: Number(body.year) || new Date().getFullYear(),
        month: Math.min(12, Math.max(1, Number(body.month) || 1)),
        note: String(body.note || '').trim(),
        ...computeSalary(body, st),
      };
      const list = load('salary');
      // 同一员工同一年月只允许一条，覆盖旧记录
      const i = list.findIndex((r) => r.empId === rec.empId && r.year === rec.year && r.month === rec.month);
      if (i >= 0) rec.id = list[i].id, list[i] = rec;
      else list.push(rec);
      save('salary', list);
      return send(res, 201, rec);
    }
  }

  m = pathname.match(/^\/api\/salary\/([^/]+)$/);
  if (m) {
    if (method === 'DELETE') {
      const list = load('salary');
      const i = list.findIndex((r) => r.id === m[1]);
      if (i < 0) return send(res, 404, { error: '记录不存在' });
      list.splice(i, 1);
      save('salary', list);
      return send(res, 200, { ok: true });
    }
    if (method === 'PUT') {
      const body = await readBody(req);
      const list = load('salary');
      const i = list.findIndex((r) => r.id === m[1]);
      if (i < 0) return send(res, 404, { error: '记录不存在' });
      const old = list[i];
      const st = loadSettings();
      // 以原始输入维度合并后整体重算
      const merged = {
        total: body.total !== undefined ? body.total : old.total,
        perfMode: body.perfMode !== undefined ? body.perfMode : (old.perfMode || 'pct'),
        perfValue: body.perfValue !== undefined ? body.perfValue
          : (old.perfValue !== undefined ? old.perfValue
            : (old.perfPct !== undefined ? old.perfPct : 100)),
        bonus: body.bonus !== undefined ? body.bonus : old.bonus,
        leaveDays: body.leaveDays !== undefined ? body.leaveDays : old.leaveDays,
        lateHours: body.lateHours !== undefined ? body.lateHours : old.lateHours,
        earlyHours: body.earlyHours !== undefined ? body.earlyHours : old.earlyHours,
      };
      const nextNote = body.note !== undefined ? String(body.note).trim() : (old.note || '');
      const computed = computeSalary(merged, st);
      if (computed.bonus > 0 && !nextNote) {
        return send(res, 400, { error: '填写奖金后需补充奖金发放原因' });
      }
      list[i] = {
        ...old,
        note: nextNote,
        ...computed,
      };
      save('salary', list);
      return send(res, 200, list[i]);
    }
  }

  // 差旅记录 CRUD
  if (pathname === '/api/travel') {
    if (method === 'GET') return send(res, 200, load('travel'));
    if (method === 'POST') {
      const body = await readBody(req);
      const rec = {
        id: uid(),
        empId: body.empId,
        date: body.date || new Date().toISOString().slice(0, 10),
        amount: Number(body.amount) || 0,
        note: body.note || '',
      };
      if (!rec.empId) return send(res, 400, { error: '缺少员工' });
      const list = load('travel');
      list.push(rec);
      save('travel', list);
      return send(res, 201, rec);
    }
  }

  m = pathname.match(/^\/api\/travel\/([^/]+)$/);
  if (m) {
    if (method === 'DELETE') {
      const list = load('travel');
      const i = list.findIndex((r) => r.id === m[1]);
      if (i < 0) return send(res, 404, { error: '记录不存在' });
      list.splice(i, 1);
      save('travel', list);
      return send(res, 200, { ok: true });
    }
    if (method === 'PUT') {
      const body = await readBody(req);
      const list = load('travel');
      const i = list.findIndex((r) => r.id === m[1]);
      if (i < 0) return send(res, 404, { error: '记录不存在' });
      list[i] = {
        ...list[i],
        amount: body.amount !== undefined ? Number(body.amount) || 0 : list[i].amount,
        date: body.date !== undefined ? body.date : list[i].date,
        note: body.note !== undefined ? body.note : list[i].note,
      };
      save('travel', list);
      return send(res, 200, list[i]);
    }
  }

  // 设备采买记录 CRUD（公司级成本，不强制归属员工）
  if (pathname === '/api/equipment') {
    if (method === 'GET') return send(res, 200, load('equipment'));
    if (method === 'POST') {
      const body = await readBody(req);
      const quantity = Math.max(1, Math.floor(Number(body.quantity) || 1));
      const unitPrice = Math.max(0, round2(body.unitPrice));
      const rec = {
        id: uid(),
        date: body.date || new Date().toISOString().slice(0, 10),
        name: String(body.name || '').trim(),
        category: String(body.category || '其他').trim() || '其他',
        quantity,
        unitPrice,
        amount: round2(quantity * unitPrice),
        vendor: String(body.vendor || '').trim(),
        note: String(body.note || '').trim(),
      };
      if (!rec.name) return send(res, 400, { error: '设备名称必填' });
      const list = load('equipment');
      list.push(rec);
      save('equipment', list);
      return send(res, 201, rec);
    }
  }

  m = pathname.match(/^\/api\/equipment\/([^/]+)$/);
  if (m) {
    const list = load('equipment');
    const i = list.findIndex((r) => r.id === m[1]);
    if (i < 0) return send(res, 404, { error: '记录不存在' });
    if (method === 'DELETE') {
      list.splice(i, 1);
      save('equipment', list);
      return send(res, 200, { ok: true });
    }
    if (method === 'PUT') {
      const body = await readBody(req);
      const old = list[i];
      const quantity = body.quantity !== undefined
        ? Math.max(1, Math.floor(Number(body.quantity) || 1))
        : old.quantity;
      const unitPrice = body.unitPrice !== undefined
        ? Math.max(0, round2(body.unitPrice))
        : old.unitPrice;
      list[i] = {
        ...old,
        date: body.date !== undefined ? body.date : old.date,
        name: body.name !== undefined ? String(body.name).trim() : old.name,
        category: body.category !== undefined ? (String(body.category).trim() || '其他') : old.category,
        quantity,
        unitPrice,
        amount: round2(quantity * unitPrice),
        vendor: body.vendor !== undefined ? String(body.vendor).trim() : old.vendor,
        note: body.note !== undefined ? String(body.note).trim() : old.note,
      };
      if (!list[i].name) return send(res, 400, { error: '设备名称必填' });
      save('equipment', list);
      return send(res, 200, list[i]);
    }
  }

  return send(res, 404, { error: 'unknown api' });
}

// ---------- 启动 ----------
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
for (const k of ['employees', 'salary', 'travel', 'equipment']) {
  if (!fs.existsSync(FILES[k])) {
    if (fs.existsSync(EXAMPLE_FILES[k])) fs.copyFileSync(EXAMPLE_FILES[k], FILES[k]);
    else fs.writeFileSync(FILES[k], '[]');
  }
}
if (!fs.existsSync(FILES.assessments)) {
  let seed = [];
  try {
    const employeeIds = new Set(load('employees').map((e) => e.id));
    seed = JSON.parse(fs.readFileSync(EXAMPLE_FILES.assessments, 'utf8'))
      .filter((r) => employeeIds.has(r.empId));
  } catch { /* 示例文件缺失时使用空列表 */ }
  save('assessments', seed);
}
if (!fs.existsSync(FILES.settings)) {
  fs.writeFileSync(FILES.settings, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
}

// 崩溃时留下日志，避免静默退出难以排查
process.on('uncaughtException', (err) => console.error('[uncaught]', err));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));

function removeOwnPidFile() {
  try {
    const saved = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    if (saved.pid === process.pid) fs.unlinkSync(PID_FILE);
  } catch { /* PID 文件不存在或已被其他实例更新 */ }
}

process.on('exit', removeOwnPidFile);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

http
  .createServer((req, res) => {
    const pathname = req.url;
    if (pathname.startsWith('/api/')) {
      handleApi(req, res, pathname).catch((e) => send(res, 500, { error: e.message }));
      return;
    }
    if (req.method === 'GET') return serveStatic(req, res, pathname);
    send(res, 405, { error: 'method not allowed' });
  })
  .on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`端口 ${PORT} 已被占用：可能已有一个实例在运行，直接访问 http://localhost:${PORT} 即可`);
    } else {
      console.error('[server]', err);
    }
    process.exit(1);
  })
  .listen(PORT, () => {
    fs.writeFileSync(PID_FILE, JSON.stringify({ pid: process.pid, port: Number(PORT) }), 'utf8');
    console.log(`员工管理系统已启动: http://localhost:${PORT}`);
  });
