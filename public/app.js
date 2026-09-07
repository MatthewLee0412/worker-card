/* ============ 员工管理系统 - 前端逻辑（零依赖） ============ */
const $ = (s, el = document) => el.querySelector(s);
const state = {
  tab: 'cards',
  year: new Date().getFullYear(),
  employees: [],
  salary: [],
  travel: [],
  settings: { baseRatio: 0.7, daysPerMonth: 26, hoursPerDay: 8 },
};

// ---------- API ----------
async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ---------- 工具 ----------
const fmt = (n) => (Number(n) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = [...Array(12)].map((_, i) => i + 1);

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.setAttribute('aria-live', 'polite');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function empName(id) { return state.employees.find((e) => e.id === id)?.name || '（已删除）'; }

/** 某员工某年的薪酬汇总 */
function salarySum(empId, year) {
  const rs = state.salary.filter((r) => r.empId === empId && r.year === year);
  const t = { base: 0, merit: 0, bonus: 0, deduct: 0, months: 0 };
  for (const r of rs) {
    t.base += r.base; t.merit += r.merit; t.bonus += r.bonus; t.deduct += r.deduct;
    if (r.base || r.merit || r.bonus || r.deduct) t.months++;
  }
  t.net = t.base + t.merit + t.bonus - t.deduct;
  return t;
}

/** 某员工某年的差旅总额 */
function travelSum(empId, year) {
  return state.travel
    .filter((r) => r.empId === empId && r.date.startsWith(String(year)))
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

// ---------- 年份选择 ----------
function initYearSel() {
  const sel = $('#yearSel');
  const years = new Set([state.year]);
  state.salary.forEach((r) => years.add(r.year));
  state.travel.forEach((r) => years.add(Number(r.date.slice(0, 4)) || state.year));
  sel.innerHTML = [...years].sort((a, b) => b - a)
    .map((y) => `<option value="${y}" ${y === state.year ? 'selected' : ''}>${y}</option>`).join('');
  sel.onchange = () => { state.year = Number(sel.value); render(); };
}

// ---------- 页面切换 ----------
document.querySelectorAll('.tab').forEach((t) =>
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => {
      x.classList.remove('active');
      x.removeAttribute('aria-current');
    });
    t.classList.add('active');
    t.setAttribute('aria-current', 'page');
    state.tab = t.dataset.tab;
    render();
  }
);

// ================= 视图：员工卡片 =================
function viewCards() {
  const emps = state.employees;
  // 工具栏始终渲染（含新增按钮），空列表时也能看到入口
  const toolbar = `
    <div class="toolbar">
      <button class="btn primary" onclick="editEmp()">＋ 新增员工</button>
      <span class="hint">共 ${emps.length} 名员工 · 统计年度 ${state.year}</span>
    </div>`;
  if (!emps.length) {
    return `${toolbar}
      <div class="panel"><div class="empty">暂无员工，点击右上角「新增员工」开始录入</div></div>`;
  }
  const cards = emps.map((e) => {
    const s = salarySum(e.id, state.year);
    const tv = travelSum(e.id, state.year);
    const total = s.net + tv;
    return `
    <div class="bcard">
      <div class="head">
      <div class="photo">${e.photo ? `<img src="${esc(e.photo)}" alt="">` : `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0H5Z"/></svg>`}</div>
        <div class="who">
          <div class="name">${esc(e.name)}${e.department ? `<span class="team-tag">${esc(e.department)}</span>` : ''}</div>
          <div class="sub">${esc(e.position || '未设置职位')} · 入职 ${esc(e.joinDate || '—')}</div>
        </div>
      </div>
      <div class="meta">
        <span><b>月薪总额</b> ¥${fmt(e.monthlyBase)}</span>
        <span><b>基本/绩效</b> ¥${fmt((Number(e.monthlyBase) || 0) * state.settings.baseRatio)} / ¥${fmt((Number(e.monthlyBase) || 0) * (1 - state.settings.baseRatio))}</span>
        <span><b>已录月份</b> ${s.months}/12</span>
        <span><b>差旅次数</b> ${state.travel.filter((r) => r.empId === e.id && r.date.startsWith(String(state.year))).length} 次</span>
      </div>
      <div class="stats">
        <div><div class="num">¥${fmt(s.net)}</div><div class="lbl">${state.year}年薪酬实发</div></div>
        <div><div class="num">¥${fmt(tv)}</div><div class="lbl">${state.year}年差旅</div></div>
        <div><div class="num">${s.months}</div><div class="lbl">录入月数</div></div>
      </div>
      <div class="total"><span>年度总成本</span><span class="num">¥${fmt(total)}</span></div>
      <div class="ops">
        <button class="btn small" onclick="editEmp('${e.id}')">编辑</button>
        <button class="btn small" onclick="quickSalary('${e.id}')">记薪酬</button>
        <button class="btn small" onclick="quickTravel('${e.id}')">记差旅</button>
        <button class="btn small danger" onclick="delEmp('${e.id}')">删除</button>
      </div>
    </div>`;
  }).join('');
  return `${toolbar}<div class="cardgrid">${cards}</div>`;
}

// 员工新增/编辑弹窗
window.editEmp = function (id) {
  const e = state.employees.find((x) => x.id === id) || {};
  openModal(`
    <h3>${id ? '编辑员工' : '新增员工'}</h3>
    <div class="form">
      <label>姓名 *<input id="f-name" value="${esc(e.name || '')}" placeholder="必填"></label>
      <label>部门<input id="f-dept" value="${esc(e.department || '')}" placeholder="如：研发部"></label>
      <label>职位<input id="f-pos" value="${esc(e.position || '')}" placeholder="如：前端工程师"></label>
      <label>入职日期<input id="f-join" type="date" value="${esc(e.joinDate || '')}"></label>
      <label>月薪总额（谈定总薪酬，元）<input id="f-base" type="number" step="0.01" value="${e.monthlyBase ?? ''}" placeholder="录入薪酬时自动带出"></label>
      <label>照片<input id="f-photo" type="file" accept="image/*"></label>
      <label class="full">备注<textarea id="f-note" rows="2">${esc(e.note || '')}</textarea></label>
      <div class="actions">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn primary" onclick="saveEmp('${id || ''}')">保存</button>
      </div>
    </div>`);
  $('#f-photo').onchange = () => {
    const f = $('#f-photo').files[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return toast('图片请小于 2MB');
    const rd = new FileReader();
    rd.onload = () => { $('#f-photo').dataset.dataurl = rd.result; };
    rd.readAsDataURL(f);
  };
};

window.saveEmp = async function (id) {
  const body = {
    name: $('#f-name').value,
    department: $('#f-dept').value,
    position: $('#f-pos').value,
    joinDate: $('#f-join').value,
    monthlyBase: $('#f-base').value,
    photo: $('#f-photo').dataset.dataurl ?? '',
    note: $('#f-note').value,
  };
  if (!body.name.trim()) return toast('姓名必填');
  try {
    if (id) {
      const old = state.employees.find((x) => x.id === id);
      if (!body.photo) body.photo = old?.photo || ''; // 未换照片则保留
      await api(`/api/employees/${id}`, 'PUT', body);
    } else {
      await api('/api/employees', 'POST', body);
    }
    closeModal();
    toast('已保存');
    await refresh();
  } catch (err) { toast(err.message); }
};

window.delEmp = async function (id) {
  if (!confirm(`确定删除「${empName(id)}」吗？其薪酬与差旅记录也会一并删除。`)) return;
  await api(`/api/employees/${id}`, 'DELETE');
  toast('已删除');
  await refresh();
};

// 卡片上的快捷入口
window.quickSalary = function (empId) { switchTab('salary'); state.salaryFilter = empId; render(); };
window.quickTravel = function (empId) { switchTab('travel'); state.travelFilter = empId; render(); };
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((x) => {
    const active = x.dataset.tab === name;
    x.classList.toggle('active', active);
    if (active) x.setAttribute('aria-current', 'page');
    else x.removeAttribute('aria-current');
  });
  state.tab = name;
}

// ================= 视图：薪酬记录 =================
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** 前端镜像计算：与服务端 computeSalary 规则一致，用于录入时实时预览 */
function computeSalary(total, perfMode, perfValue, bonus, leaveDays, lateHours, earlyHours) {
  const st = state.settings;
  const t = Number(total) || 0;
  const base = round2(t * st.baseRatio);
  const stdMerit = round2(t * (1 - st.baseRatio)); // 绩效基数（100% 时）
  let merit, perfPct;
  if (perfMode === 'amount') {
    merit = round2(perfValue);
    perfPct = stdMerit > 0 ? round2(merit / stdMerit * 100) : null; // 折算系数，仅展示
  } else {
    perfPct = (perfValue === '' || perfValue === undefined) ? 100 : Number(perfValue);
    merit = round2(stdMerit * perfPct / 100);
  }
  const b = round2(bonus);
  const daily = base / st.daysPerMonth;             // 日薪 = 基本工资 / 26
  const hourly = daily / st.hoursPerDay;            // 时薪 = 日薪 / 8
  const leaveDeduct = round2((Number(leaveDays) || 0) * daily);
  const lateDeduct = round2(((Number(lateHours) || 0) + (Number(earlyHours) || 0)) * hourly);
  const deduct = round2(leaveDeduct + lateDeduct);
  return {
    base, stdMerit, merit, perfPct, bonus: b, leaveDeduct, lateDeduct, deduct,
    net: round2(base + merit + b - deduct),
    daily: round2(daily), hourly: round2(hourly),
  };
}

/** 是否为新版自动计算记录 */
const isNewRec = (r) => r.total !== undefined;

function viewSalary() {
  const filter = state.salaryFilter || '';
  const rows = state.salary
    .filter((r) => r.year === state.year && (!filter || r.empId === filter))
    .sort((a, b) => empName(a.empId).localeCompare(empName(b.empId), 'zh') || a.month - b.month);
  const trs = rows.map((r) => `<tr ${r.note ? `title="${esc(r.note)}"` : ''}>
      <td>${esc(empName(r.empId))}</td><td>${r.month} 月</td>
      <td class="num">${isNewRec(r) ? fmt(r.total) : '—'}</td>
      <td class="num">${fmt(r.base)}</td>
      <td class="num">${fmt(r.merit)}${!isNewRec(r) || r.perfMode === 'amount'
        ? '' : `<div class="secondary-value">${r.perfPct}%</div>`}</td>
      <td class="num">${fmt(r.bonus)}</td>
      <td class="num">${isNewRec(r) ? (r.leaveDays || '—') : '—'}</td>
      <td class="num">${isNewRec(r) ? `${r.lateHours || 0} / ${r.earlyHours || 0}` : '—'}</td>
      <td class="num neg">-${fmt(r.deduct)}</td>
      <td class="num pos">${fmt(r.base + r.merit + r.bonus - r.deduct)}</td>
      <td class="row-actions">
        <button class="btn small" onclick="editSalary('${r.id}')">编辑</button>
        <button class="btn small danger" onclick="delSalary('${r.id}')">删除</button>
      </td>
    </tr>`).join('');
  const sum = rows.reduce((a, r) => ({
    base: a.base + r.base, merit: a.merit + r.merit, bonus: a.bonus + r.bonus, deduct: a.deduct + r.deduct,
  }), { base: 0, merit: 0, bonus: 0, deduct: 0 });
  const st = state.settings;
  return `
    <div class="toolbar">
      <button class="btn primary" onclick="editSalary()">＋ 录入薪酬</button>
      <label class="filter-field">员工筛选
        <select onchange="state.salaryFilter=this.value;render()">
          <option value="">全部</option>
          ${state.employees.map((e) => `<option value="${e.id}" ${filter === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
        </select>
      </label>
      <span class="hint salary-rule-hint">规则：基本工资 ${Math.round(st.baseRatio * 100)}% / 绩效 ${Math.round((1 - st.baseRatio) * 100)}% · 日薪 = 基本 ÷ ${st.daysPerMonth} 天 · 时薪 = 日薪 ÷ ${st.hoursPerDay} 小时 · ${state.year}年 ${rows.length} 条</span>
    </div>
    <div class="panel">
      <h2>薪酬明细（实发 = 基本工资 + 绩效 + 奖金 − 事假/迟到扣款）</h2>
      <div class="table-scroll"><table class="wide-table salary-table">
        <colgroup>
          <col style="width:88px"><col style="width:68px"><col style="width:100px"><col style="width:100px">
          <col style="width:108px"><col style="width:82px"><col style="width:76px"><col style="width:100px">
          <col style="width:92px"><col style="width:104px"><col style="width:120px">
        </colgroup>
        <thead><tr>
          <th scope="col">员工</th><th scope="col">月份</th><th scope="col" class="num">月薪总额</th><th scope="col" class="num">基本工资</th><th scope="col" class="num">绩效</th><th scope="col" class="num">奖金</th>
          <th scope="col" class="num">事假<br><span class="secondary-value">（天）</span></th><th scope="col" class="num">迟到/早退<br><span class="secondary-value">（小时）</span></th><th scope="col" class="num">扣款</th><th scope="col" class="num">实发</th><th scope="col" class="action-head">操作</th>
        </tr></thead>
        <tbody>${trs || `<tr><td colspan="11" class="empty">${state.year}年暂无薪酬记录，点击「录入薪酬」添加</td></tr>`}</tbody>
        ${trs ? `<tfoot><tr style="font-weight:700">
          <td colspan="3">合计</td>
          <td class="num">${fmt(sum.base)}</td><td class="num">${fmt(sum.merit)}</td>
          <td class="num">${fmt(sum.bonus)}</td><td colspan="2"></td><td class="num neg">-${fmt(sum.deduct)}</td>
          <td class="num pos">${fmt(sum.base + sum.merit + sum.bonus - sum.deduct)}</td><td></td>
        </tr></tfoot>` : ''}
      </table></div>
    </div>`;
}

/** 录入/编辑薪酬。传 id 时为编辑模式 */
window.editSalary = function (id) {
  if (!state.employees.length) return toast('请先在「员工卡片」页添加员工');
  const rec = id ? state.salary.find((r) => r.id === id) : null;
  const empId = rec?.empId || state.salaryFilter || state.employees[0].id;
  const emp = state.employees.find((e) => e.id === empId);
  const st = state.settings;
  const mode = rec?.perfMode || 'pct';
  const perfVal = rec ? (rec.perfValue ?? rec.perfPct ?? 100) : 100;
  const baseVal = rec
    ? (rec.base ?? round2((Number(rec.total) || 0) * st.baseRatio))
    : round2((Number(emp?.monthlyBase) || 0) * st.baseRatio);
  openModal(`
    <h3>${rec ? '编辑薪酬' : '录入薪酬'} · ${state.year}年</h3>
    <div class="form">
      <label>员工
        <select id="s-emp" ${rec ? 'disabled' : ''}>${state.employees.map((e) => `<option value="${e.id}" ${e.id === empId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
      </label>
      <label>月份
        <select id="s-month" ${rec ? 'disabled' : ''}>${MONTHS.map((m) => `<option value="${m}" ${rec?.month === m ? 'selected' : ''}>${m} 月</option>`).join('')}</select>
      </label>
      <label><span class="field-head"><span>基本工资</span></span><div class="input-affix has-prefix"><span class="input-prefix" aria-hidden="true">¥</span><input id="s-base" type="number" step="0.01" min="0" value="${baseVal}" placeholder="本月基本工资"></div></label>
      <div class="form-field">
        <div class="field-head">
          <label for="s-perf">绩效</label>
          <div class="perf-unit-toggle" role="group" aria-label="绩效输入方式">
            <label class="unit-option" title="按百分比输入">
              <input type="radio" name="perfMode" value="pct" aria-label="按百分比输入" ${mode === 'pct' ? 'checked' : ''}><span>%</span>
            </label>
            <label class="unit-option" title="按金额输入">
              <input type="radio" name="perfMode" value="amount" aria-label="按金额输入" ${mode === 'amount' ? 'checked' : ''}><span>¥</span>
            </label>
          </div>
        </div>
        <div class="input-affix" id="s-perf-affix"><span id="s-perf-prefix" class="input-prefix" aria-hidden="true" hidden>¥</span><input id="s-perf" type="number" step="0.01" min="0" value="${perfVal}"><span id="s-perf-suffix" class="input-suffix" aria-hidden="true">%</span></div>
      </div>
      <label><span class="field-head"><span>奖金</span></span><div class="input-affix has-prefix"><span class="input-prefix" aria-hidden="true">¥</span><input id="s-bonus" type="number" step="0.01" min="0" value="${rec?.bonus ?? ''}" placeholder="0"></div></label>
      <label><span class="field-head"><span>奖金备注</span><span id="s-bonus-note-help" class="field-helper">有奖金时必填</span></span><input id="s-note" value="${esc(rec?.note || '')}" placeholder="如：项目奖金、年度激励"></label>
      <label>事假<div class="input-affix has-suffix"><input id="s-leave" type="number" step="0.5" min="0" value="${rec?.leaveDays ?? 0}"><span class="input-suffix" aria-hidden="true">天</span></div></label>
      <label>迟到<div class="input-affix has-suffix"><input id="s-late" type="number" step="0.5" min="0" value="${rec?.lateHours ?? 0}"><span class="input-suffix" aria-hidden="true">小时</span></div></label>
      <label>早退<div class="input-affix has-suffix"><input id="s-early" type="number" step="0.5" min="0" value="${rec?.earlyHours ?? 0}"><span class="input-suffix" aria-hidden="true">小时</span></div></label>
      <div class="full salary-preview" id="s-preview"></div>
      <div class="actions">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn primary" onclick="saveSalary('${id || ''}')">保存</button>
      </div>
    </div>`);

  const curMode = () => document.querySelector('input[name="perfMode"]:checked').value;
  const totalFromBase = () => st.baseRatio > 0
    ? round2((Number($('#s-base').value) || 0) / st.baseRatio)
    : 0;
  const calc = () => computeSalary(
    totalFromBase(), curMode(), $('#s-perf').value,
    $('#s-bonus').value, $('#s-leave').value, $('#s-late').value, $('#s-early').value,
  );

  const upd = () => {
    const c = calc();
    const isPct = curMode() === 'pct';
    const affix = $('#s-perf-affix');
    affix.classList.toggle('has-prefix', !isPct);
    affix.classList.toggle('has-suffix', isPct);
    $('#s-perf-prefix').hidden = isPct;
    $('#s-perf-suffix').hidden = !isPct;
    const bonusNote = $('#s-note');
    bonusNote.required = c.bonus > 0;
    if (!c.bonus) bonusNote.setCustomValidity('');
    $('#s-bonus-note-help').textContent = c.bonus > 0 ? '必填' : '有奖金时必填';
    const perfMark = isPct ? `${$('#s-perf').value || 100}%` : '按金额';
    $('#s-preview').innerHTML = `
      <div class="preview-title">本月薪酬预览</div>
      <div class="preview-components">
        <div class="preview-item"><span>基本工资 · ${Math.round(st.baseRatio * 100)}%</span><strong>¥${fmt(c.base)}</strong></div>
        <div class="preview-item"><span>绩效 · ${perfMark}</span><strong>¥${fmt(c.merit)}</strong></div>
        <div class="preview-item"><span>奖金</span><strong>¥${fmt(c.bonus)}</strong></div>
      </div>
      <div class="preview-deduct">扣款 −¥${fmt(c.deduct)} · 事假 ${$('#s-leave').value || 0} 天 · 迟到/早退 ${(Number($('#s-late').value) || 0) + (Number($('#s-early').value) || 0)} 小时</div>
      <div class="preview-total"><span>本月实发</span><strong>¥${fmt(c.net)}</strong></div>`;
  };

  // 切换模式时保持绩效发放金额等值，输入值始终直接参与本月绩效计算。
  let previousMode = mode;
  document.querySelectorAll('input[name="perfMode"]').forEach((r) => r.addEventListener('change', () => {
    const raw = Number($('#s-perf').value) || 0;
    const baseCalc = computeSalary(totalFromBase(), 'pct', 100, 0, 0, 0, 0);
    if (r.value === 'amount' && previousMode === 'pct') {
      $('#s-perf').value = round2(baseCalc.stdMerit * raw / 100);
    } else if (r.value === 'pct' && previousMode === 'amount') {
      $('#s-perf').value = baseCalc.stdMerit > 0 ? round2(raw / baseCalc.stdMerit * 100) : 100;
    }
    previousMode = r.value;
    upd();
  }));
  ['s-base', 's-perf', 's-bonus', 's-leave', 's-late', 's-early'].forEach((id2) => {
    $('#' + id2).addEventListener('input', upd);
  });
  $('#s-note').addEventListener('input', () => {
    if ($('#s-note').value.trim()) $('#s-note').setCustomValidity('');
  });
  upd();
};

window.saveSalary = async function (id) {
  const perfMode = document.querySelector('input[name="perfMode"]:checked').value;
  const st = state.settings;
  const body = {
    empId: $('#s-emp').value,
    year: state.year,
    month: $('#s-month').value,
    total: st.baseRatio > 0 ? round2((Number($('#s-base').value) || 0) / st.baseRatio) : 0,
    perfMode,
    perfValue: $('#s-perf').value === '' ? (perfMode === 'pct' ? 100 : 0) : $('#s-perf').value,
    bonus: $('#s-bonus').value || 0,
    leaveDays: $('#s-leave').value || 0,
    lateHours: $('#s-late').value || 0,
    earlyHours: $('#s-early').value || 0,
    note: $('#s-note').value,
  };
  if (Number(body.bonus) > 0 && !body.note.trim()) {
    const bonusNote = $('#s-note');
    bonusNote.setCustomValidity('请填写奖金发放原因');
    bonusNote.reportValidity();
    bonusNote.focus();
    return;
  }
  try {
    if (id) await api(`/api/salary/${id}`, 'PUT', body);
    else await api('/api/salary', 'POST', body);
    closeModal(); toast(id ? '薪酬已更新' : '薪酬已录入');
    await refresh();
  } catch (err) { toast(err.message); }
};

window.delSalary = async function (id) {
  if (!confirm('删除这条薪酬记录？')) return;
  await api(`/api/salary/${id}`, 'DELETE');
  toast('已删除'); await refresh();
};

// ================= 视图：差旅成本 =================
function viewTravel() {
  const filter = state.travelFilter || '';
  const rows = state.travel
    .filter((r) => r.date.startsWith(String(state.year)) && (!filter || r.empId === filter))
    .sort((a, b) => b.date.localeCompare(a.date));
  const trs = rows.map((r) => `<tr>
    <td>${r.date}</td><td>${esc(empName(r.empId))}</td>
    <td class="num pos">${fmt(r.amount)}</td>
    <td style="font-size:12px;color:#98a0aa">${esc(r.note)}</td>
    <td><button class="btn small danger" onclick="delTravel('${r.id}')">删除</button></td>
  </tr>`).join('');
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  // 按员工小计
  const byEmp = {};
  rows.forEach((r) => { byEmp[r.empId] = (byEmp[r.empId] || 0) + (Number(r.amount) || 0); });
  const sub = Object.entries(byEmp).sort((a, b) => b[1] - a[1])
    .map(([id, v]) => `<tr><td>${esc(empName(id))}</td><td class="num pos">${fmt(v)}</td></tr>`).join('');
  return `
    <div class="toolbar">
      <button class="btn primary" onclick="addTravel()">＋ 记一笔差旅</button>
      <label class="filter-field">员工筛选
        <select onchange="state.travelFilter=this.value;render()">
          <option value="">全部</option>
          ${state.employees.map((e) => `<option value="${e.id}" ${filter === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
        </select>
      </label>
      <span class="hint">${state.year}年差旅总额：¥${fmt(total)}</span>
    </div>
    <div class="panel">
      <h2>差旅明细</h2>
      <div class="table-scroll"><table>
        <thead><tr><th scope="col">日期</th><th scope="col">员工</th><th scope="col" class="num">金额</th><th scope="col">备注（去哪/干什么）</th><th scope="col" class="action-head">操作</th></tr></thead>
        <tbody>${trs || `<tr><td colspan="5" class="empty">${state.year}年暂无差旅记录，点击「记一笔差旅」添加</td></tr>`}</tbody>
      </table></div>
    </div>
    ${sub ? `<div class="panel"><h2>按员工小计</h2><div class="table-scroll"><table>
      <thead><tr><th scope="col">员工</th><th scope="col" class="num">差旅合计</th></tr></thead><tbody>${sub}</tbody></table></div></div>` : ''}`;
}

window.addTravel = function () {
  if (!state.employees.length) return toast('请先在「员工卡片」页添加员工');
  const empId = state.travelFilter || state.employees[0].id;
  openModal(`
    <h3>记一笔差旅（${state.year}年）</h3>
    <div class="form">
      <label>员工 *
        <select id="t-emp">${state.employees.map((e) => `<option value="${e.id}" ${e.id === empId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
      </label>
      <label>日期<input id="t-date" type="date" value="${state.year}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}"></label>
      <label>金额（元）<input id="t-amount" type="number" step="0.01" placeholder="如 3500"></label>
      <label>备注<input id="t-note" placeholder="如：上海出差 3 天"></label>
      <div class="actions">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn primary" onclick="saveTravel()">保存</button>
      </div>
    </div>`);
};

window.saveTravel = async function () {
  try {
    await api('/api/travel', 'POST', {
      empId: $('#t-emp').value,
      date: $('#t-date').value,
      amount: $('#t-amount').value || 0,
      note: $('#t-note').value,
    });
    closeModal(); toast('差旅已记录');
    await refresh();
  } catch (err) { toast(err.message); }
};

window.delTravel = async function (id) {
  if (!confirm('删除这条差旅记录？')) return;
  await api(`/api/travel/${id}`, 'DELETE');
  toast('已删除'); await refresh();
};

// ================= 视图：统计报表 =================
const DEPT_COLORS = ['#3370ff', '#2e9e5b', '#e8a33d', '#9a6fd8', '#e5484d', '#3ab0c9', '#8a94a6'];

function viewReport() {
  const y = state.year;
  const rows = state.employees.map((e) => {
    const s = salarySum(e.id, y);
    const tv = travelSum(e.id, y);
    return { e, ...s, travel: tv, total: s.net + tv };
  }).sort((a, b) => b.total - a.total);

  const tot = rows.reduce((a, r) => ({
    base: a.base + r.base, merit: a.merit + r.merit, bonus: a.bonus + r.bonus,
    deduct: a.deduct + r.deduct, travel: a.travel + r.travel, total: a.total + r.total,
  }), { base: 0, merit: 0, bonus: 0, deduct: 0, travel: 0, total: 0 });

  // 月度趋势（薪酬实发 + 差旅）
  const mm = (m) => String(m).padStart(2, '0');
  const monthly = MONTHS.map((m) => {
    const sal = state.salary
      .filter((r) => r.year === y && r.month === m)
      .reduce((s, r) => s + r.base + r.merit + r.bonus - r.deduct, 0);
    const tv = state.travel
      .filter((r) => r.date.startsWith(`${y}-${mm(m)}`))
      .reduce((s, r) => s + (Number(r.amount) || 0), 0);
    return { m, sal, tv, all: sal + tv };
  });
  const maxM = Math.max(...monthly.map((x) => x.all), 1);

  // 部门汇总
  const depts = {};
  rows.forEach((r) => {
    const d = r.e.department || '未分配';
    depts[d] = (depts[d] || 0) + r.total;
  });
  const deptArr = Object.entries(depts).sort((a, b) => b[1] - a[1]);

  const trs = rows.map((r, i) => `<tr>
    <td>${i + 1}</td><td><b>${esc(r.e.name)}</b></td><td>${esc(r.e.department)}</td>
    <td class="num">${fmt(r.base)}</td><td class="num">${fmt(r.merit)}</td><td class="num">${fmt(r.bonus)}</td>
    <td class="num neg">-${fmt(r.deduct)}</td><td class="num">${fmt(r.net)}</td>
    <td class="num">${fmt(r.travel)}</td>
    <td class="num pos">¥${fmt(r.total)}</td>
  </tr>`).join('');

  return `
    <div class="kpis">
      <div class="kpi highlight"><div class="v">¥${fmt(tot.total)}</div><div class="t">${y}年人力总成本（薪酬+差旅）</div></div>
      <div class="kpi"><div class="v">¥${fmt(tot.base)}</div><div class="t">固定月薪合计</div></div>
      <div class="kpi"><div class="v">¥${fmt(tot.merit)}</div><div class="t">绩效合计</div></div>
      <div class="kpi"><div class="v">¥${fmt(tot.bonus)}</div><div class="t">奖金合计</div></div>
      <div class="kpi"><div class="v">¥${fmt(tot.deduct)}</div><div class="t">扣款合计</div></div>
      <div class="kpi"><div class="v">¥${fmt(tot.travel)}</div><div class="t">差旅合计</div></div>
    </div>
    <div class="report-grid">
      <div class="panel"><h2>月度支出趋势</h2>
        <div class="barchart">
          ${monthly.map((x) => `
            <div class="col">
              <div class="bar${x.all ? '' : ' is-zero'}" style="height:${x.all ? Math.max(2, (x.all / maxM) * 100) : 0}%">
                <span class="tip">${x.all ? (x.all / 10000).toFixed(1) + '万' : ''}</span>
              </div>
              <span class="ml">${x.m}月</span>
            </div>`).join('')}
        </div>
      </div>
      <div class="panel"><h2>部门成本占比</h2>
        ${deptArr.length && tot.total ? `
          <div class="dept-breakdown">
            ${deptArr.map(([d, v], i) => {
              const pct = (v / tot.total) * 100;
              const color = DEPT_COLORS[i % DEPT_COLORS.length];
              return `<div class="dept-item">
                <div class="dept-item-head">
                  <div class="dept-name"><span class="dept-dot" style="background:${color}" aria-hidden="true"></span><span class="dept-name-text">${esc(d)}</span></div>
                  <div class="dept-metrics">¥${fmt(v)}<strong>${pct.toFixed(1)}%</strong></div>
                </div>
                <div class="dept-track" role="img" aria-label="${esc(d)}占年度总成本${pct.toFixed(1)}%">
                  <span class="dept-fill" style="width:${pct}%;background:${color}"></span>
                </div>
              </div>`;
            }).join('')}
          </div>` : `<div class="empty">暂无数据</div>`}
      </div>
    </div>
    <div class="panel">
      <h2>年度总成本排行（${y}）</h2>
      <div class="table-scroll"><table class="wide-table report-table">
        <thead><tr><th scope="col">#</th><th scope="col">员工</th><th scope="col">部门</th><th scope="col" class="num">月薪</th><th scope="col" class="num">绩效</th><th scope="col" class="num">奖金</th><th scope="col" class="num">扣款</th><th scope="col" class="num">薪酬实发</th><th scope="col" class="num">差旅</th><th scope="col" class="num">年度总成本</th></tr></thead>
        <tbody>${trs || `<tr><td colspan="10" class="empty">暂无数据</td></tr>`}</tbody>
        ${trs ? `<tfoot><tr style="font-weight:700">
          <td colspan="3">合计</td>
          <td class="num">${fmt(tot.base)}</td><td class="num">${fmt(tot.merit)}</td><td class="num">${fmt(tot.bonus)}</td>
          <td class="num neg">-${fmt(tot.deduct)}</td><td class="num">${fmt(tot.base + tot.merit + tot.bonus - tot.deduct)}</td>
          <td class="num">${fmt(tot.travel)}</td><td class="num pos">¥${fmt(tot.total)}</td>
        </tr></tfoot>` : ''}
      </table></div>
      <div class="toolbar" style="margin-top:14px">
        <button class="btn" onclick="exportReport()">导出年度核算报表（CSV，Excel 可打开）</button>
      </div>
    </div>`;
}

window.exportReport = function () {
  const y = state.year;
  const rows = state.employees.map((e) => {
    const s = salarySum(e.id, y);
    const tv = travelSum(e.id, y);
    return [e.name, e.department, e.position, s.base, s.merit, s.bonus, s.deduct, s.net, tv, s.net + tv];
  }).sort((a, b) => b[9] - a[9]);
  const tot = rows.reduce((a, r) => a.map((v, i) => (i < 3 ? '' : v + r[i])), ['', '', '', 0, 0, 0, 0, 0, 0, 0]);
  const csv = [
    [`员工年度成本核算报表 ${y}年`],
    ['姓名', '部门', '职位', '月薪合计', '绩效合计', '奖金合计', '扣款合计', '薪酬实发', '差旅合计', '年度总成本'],
    ...rows,
    ['合计', '', '', ...tot.slice(3)],
  ].map((line) => line.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  // 加 BOM 让 Excel 正确识别中文
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `年度成本核算_${y}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('已导出');
};

// ---------- 弹窗 ----------
function openModal(html) {
  closeModal();
  const mask = document.createElement('div');
  mask.className = 'mask';
  mask.id = 'mask';
  mask.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  mask.addEventListener('click', (e) => { if (e.target === mask) closeModal(); });
  document.body.appendChild(mask);
}
window.closeModal = function () { $('#mask')?.remove(); };

// ---------- 薪酬规则设置 ----------
$('#settingsBtn').onclick = () => {
  const st = state.settings;
  openModal(`
    <h3>薪酬规则设置</h3>
    <div class="form">
      <label>基本工资占月薪总额比例（%）<input id="st-ratio" type="number" step="1" min="10" max="90" value="${Math.round(st.baseRatio * 100)}"></label>
      <label>绩效占比（%）<input id="st-perf" disabled value="${Math.round((1 - st.baseRatio) * 100)}"></label>
      <label>每月计薪天数（事假按天扣）<input id="st-days" type="number" step="0.5" min="1" max="31" value="${st.daysPerMonth}"></label>
      <label>每日工时（小时，迟到/早退按小时扣）<input id="st-hours" type="number" step="0.5" min="1" max="24" value="${st.hoursPerDay}"></label>
      <div class="full" style="font-size:12px;color:var(--sub);line-height:1.8">
        计算规则：基本工资 = 总额 × 比例；绩效 = 总额 × 绩效占比 × 绩效系数；日薪 = 基本工资 ÷ 计薪天数；时薪 = 日薪 ÷ 每日工时。修改规则后新保存的记录按新规则计算。
      </div>
      <div class="actions">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn primary" onclick="saveSettings()">保存</button>
      </div>
    </div>`);
  $('#st-ratio').addEventListener('input', () => {
    const v = Number($('#st-ratio').value);
    if (v >= 10 && v <= 90) $('#st-perf').value = Math.round(100 - v);
  });
};

window.saveSettings = async function () {
  const ratio = Number($('#st-ratio').value) / 100;
  if (!(ratio >= 0.1 && ratio <= 0.9)) return toast('基本工资比例需在 10% ~ 90% 之间');
  try {
    state.settings = await api('/api/settings', 'PUT', {
      baseRatio: ratio,
      daysPerMonth: $('#st-days').value,
      hoursPerDay: $('#st-hours').value,
    });
    closeModal(); toast('薪酬规则已更新');
    render();
  } catch (err) { toast(err.message); }
};

// ---------- 渲染 ----------
function render() {
  const views = { cards: viewCards, salary: viewSalary, travel: viewTravel, report: viewReport };
  $('#app').innerHTML = views[state.tab]();
}

async function refresh() {
  const [employees, salary, travel, settings] = await Promise.all([
    api('/api/employees'), api('/api/salary'), api('/api/travel'), api('/api/settings'),
  ]);
  state.employees = employees;
  state.salary = salary;
  state.travel = travel;
  state.settings = settings;
  initYearSel();
  render();
}

refresh();
