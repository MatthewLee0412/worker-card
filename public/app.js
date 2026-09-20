/* ============ 员工管理系统 - 前端逻辑（零依赖） ============ */
const $ = (s, el = document) => el.querySelector(s);
const state = {
  tab: 'cards',
  year: new Date().getFullYear(),
  employees: [],
  salary: [],
  travel: [],
  equipment: [],
  assessments: [],
  equipmentApiAvailable: true,
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
const COMPETENCIES = [
  { id: 'ownership', name: '主人翁精神', short: '主人翁', description: '主动承担责任，持续推进问题直到闭环' },
  { id: 'openness', name: '开放心态', short: '开放心态', description: '愿意面对事实、接受反馈并修正判断' },
  { id: 'judgment', name: '逻辑判断', short: '逻辑判断', description: '识别关键问题，依据事实做出可靠判断' },
  { id: 'learning', name: '学习适应', short: '学习适应', description: '快速学习，在新情况中调整方法' },
  { id: 'execution', name: '执行交付', short: '执行交付', description: '稳定完成承诺，并产出可验证的结果' },
  { id: 'collaboration', name: '协作沟通', short: '协作沟通', description: '清晰同步信息，推动多人共同完成目标' },
];
const SOURCE_NAMES = { manager: '主管观察', self: '员工自评', peer: '同事反馈', result: '工作结果' };

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
function competency(id) { return COMPETENCIES.find((x) => x.id === id) || { id, name: id, short: id, description: '' }; }
const average = (list) => list.length ? list.reduce((sum, x) => sum + Number(x), 0) / list.length : null;
const scoreText = (n) => n === null ? '证据不足' : ({ 1: '需要指导', 2: '尚不稳定', 3: '可以独立', 4: '稳定优秀', 5: '可指导他人' }[Math.round(n)]);
const scoreTone = (n) => n === null ? 'no-score' : n >= 4 ? 'strong' : n < 3 ? 'watch' : 'steady';

// ---------- 画像算法参数（详见 docs/profile-algorithm.md） ----------
const PROFILE_OPTIONS = {
  prior: { mean: 3, strength: 3 }, // 先验：相当于 k 条「3 分可以独立完成」的虚拟证据
  strengthLine: 3.5,               // 优势线（作用于收缩分）；关注方向为低于此值
  minEvidence: 2,                  // 优势/关注方向的最低证据条数，低于此值显示「样本不足」
  blindspotGap: 1,                 // 盲区提示：自评与他评的差距阈值
  blindspotMinOther: 2,            // 盲区提示所需的最少他评条数
  // 时间衰减（v3）：旧证据权重按半年半衰期折算，w = 0.5^(天数/180)
  decay: { halfLifeDays: 180 },
  // 近 90 天趋势（只播报事实，不影响分数）；箭头需两侧各 ≥2 条且差距 ≥0.5
  trend: { windowDays: 90, minSide: 2, arrowThreshold: 0.5 },
  stalenessDays: 180,              // 最新证据超过该天数则提示画像可能过时
};

/** 员工画像：原始证据经 ProfileMath 聚合（贝叶斯收缩 + 三因子可信度），见 docs/profile-algorithm.md */
function talentProfile(empId) {
  const records = state.assessments.filter((r) => r.empId === empId);
  const p = ProfileMath.buildProfile(records, COMPETENCIES, PROFILE_OPTIONS);
  return { ...p, confidence: p.confidenceLabel };
}

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

/** 某年的公司设备采买总额 */
function equipmentSum(year) {
  return state.equipment
    .filter((r) => r.date.startsWith(String(year)))
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

// ---------- 年份选择 ----------
function initYearSel() {
  const sel = $('#yearSel');
  const years = new Set([state.year]);
  state.salary.forEach((r) => years.add(r.year));
  state.travel.forEach((r) => years.add(Number(r.date.slice(0, 4)) || state.year));
  state.equipment.forEach((r) => years.add(Number(r.date.slice(0, 4)) || state.year));
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

// ================= 视图：人才棒球卡 =================
function viewCards() {
  const emps = state.employees;
  const toolbar = `
    <section class="talent-intro" aria-labelledby="talent-title">
      <div>
        <div class="eyebrow">PEOPLE PROFILE</div>
        <h1 id="talent-title">人才棒球卡</h1>
        <p>用持续的事实记录认识每个人的优势与边界。分数是线索，证据才是判断依据。</p>
      </div>
      <div class="talent-actions">
        <button class="btn" onclick="editAssessment()">记录观察</button>
        <button class="btn primary" onclick="editEmp()">新增员工</button>
      </div>
    </section>
    <div class="toolbar talent-toolbar">
      <span class="hint">${emps.length} 名员工 · ${state.assessments.length} 条观察记录 · 画像分数按证据量收缩校准（算法见 docs/profile-algorithm.md）</span>
    </div>`;
  if (!emps.length) {
    return `${toolbar}
      <div class="panel"><div class="empty">暂无员工，点击「新增员工」建立第一张人才棒球卡</div></div>`;
  }
  const cards = emps.map((e) => {
    const p = talentProfile(e.id);
    const strengthTags = p.strengths.length
      ? p.strengths.map((d) => `<span class="talent-chip strength">${esc(d.short)} · ${d.score.toFixed(1)}</span>`).join('')
      : '<span class="talent-chip neutral">等待更多证据</span>';
    const watchTags = p.development.length
      ? p.development.map((d) => `<span class="talent-chip watch">${esc(d.short)} · ${d.score.toFixed(1)}</span>`).join('')
      : '<span class="talent-chip neutral">暂未识别</span>';
    const dimensionRows = p.dimensions.map((d) => `
      <div class="mini-score ${d.insufficient ? 'insufficient' : scoreTone(d.score)}">
        <span>${esc(d.short)}</span>
        <div class="score-track" aria-label="${esc(d.name)} ${d.score === null ? '证据不足' : `${d.score.toFixed(1)} 分`}">
          <span style="width:${d.score === null ? 0 : d.score * 20}%"></span>
        </div>
        <b>${d.score === null ? '—' : d.score.toFixed(1)}</b>
      </div>`).join('');
    return `
    <div class="bcard">
      <div class="head">
      <div class="photo">${e.photo ? `<img src="${esc(e.photo)}" alt="${esc(e.name)}的头像">` : `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0H5Z"/></svg>`}</div>
        <div class="who">
          <div class="name">${esc(e.name)}${e.department ? `<span class="team-tag">${esc(e.department)}</span>` : ''}</div>
          <div class="sub">${esc(e.position || '未设置职位')} · 入职 ${esc(e.joinDate || '—')}</div>
        </div>
        <span class="confidence ${p.records.length ? '' : 'is-empty'}" title="可信度 ${p.confidenceScore} 分｜样本 ${p.confidenceParts.sample}% · 维度覆盖 ${p.confidenceParts.coverage}% · 评价人 ${p.confidenceParts.observers}%">${p.confidence}</span>
      </div>
      <p class="role-summary">${esc(e.roleSummary || '尚未填写角色画像。建议说明这个人最适合承担哪类工作。')}</p>
      <div class="talent-group">
        <div class="talent-label"><span>核心优势</span><small>基于高分证据</small></div>
        <div class="talent-chips">${strengthTags}</div>
      </div>
      <div class="talent-group">
        <div class="talent-label"><span>关注方向</span><small>不是负面标签</small></div>
        <div class="talent-chips">${watchTags}</div>
      </div>
      <div class="mini-scores">${dimensionRows}</div>
      <div class="evidence-summary">
        <span><b>${p.records.length}</b> 条证据</span>
        <span><b>${p.observers}</b> 位评价人</span>
        <span>${p.latest ? `更新于 ${esc(p.latest)}${p.stale ? '，证据已陈旧' : ''}` : '尚未开始评价'}</span>
      </div>
      <div class="ops">
        <button class="btn small primary-soft" onclick="viewTalentProfile('${e.id}')">查看画像</button>
        <button class="btn small" onclick="editAssessment('${e.id}')">记录观察</button>
        <button class="btn small" onclick="editEmp('${e.id}')">编辑档案</button>
        <button class="btn small danger" onclick="delEmp('${e.id}')">删除</button>
      </div>
    </div>`;
  }).join('');
  return `${toolbar}<div class="cardgrid">${cards}</div>`;
}

window.viewTalentProfile = function (empId) {
  const e = state.employees.find((x) => x.id === empId);
  if (!e) return;
  const p = talentProfile(empId);
  const skillTags = (e.skills || []).length
    ? e.skills.map((x) => `<span class="skill-chip">${esc(x)}</span>`).join('')
    : '<span class="muted-copy">暂未填写专业技能</span>';
  const scoreRows = p.dimensions.map((d) => `
    <div class="profile-score-row ${d.insufficient ? 'insufficient' : scoreTone(d.score)}">
      <div class="profile-score-head">
        <span><b>${esc(d.name)}</b><small>${esc(d.description)}</small></span>
        <strong>${d.score === null ? '—' : d.score.toFixed(1)}</strong>
      </div>
      <div class="profile-score-track"><span style="width:${d.score === null ? 0 : d.score * 20}%"></span></div>
      <div class="score-meta">
        <span>${scoreText(d.score)} · ${d.n} 条证据${d.n > 0 ? ` · 原始均分 ${d.rawScore.toFixed(1)}` : ''}${d.insufficient ? '（样本不足，继续观察）' : ''}${d.trend ? ` · 近${PROFILE_OPTIONS.trend.windowDays}天 ${d.trend.recentMean.toFixed(1)}${d.trend.arrow === 'up' ? ' ↑' : d.trend.arrow === 'down' ? ' ↓' : ''}` : ''}</span>
        ${(d.selfScore !== null || d.otherScore !== null) ? `<span>自评 ${d.selfScore === null ? '—' : d.selfScore.toFixed(1)} / 他评 ${d.otherScore === null ? '—' : d.otherScore.toFixed(1)}</span>` : ''}
      </div>
      ${d.blindspot ? `<div class="blindspot-hint">${d.blindspot.direction === 'self-higher' ? `自评高于他评 ${d.blindspot.gap} 分——可能存在认知盲区，建议一对一沟通核对` : `自评低于他评 ${-d.blindspot.gap} 分——自我要求可能高于团队共识，也值得核对`}</div>` : ''}
    </div>`).join('');
  const timeline = p.records.length ? p.records.map((r) => `
    <article class="evidence-item">
      <div class="evidence-mark score-${r.score}" aria-label="${r.score} 分">${r.score}</div>
      <div class="evidence-body">
        <div class="evidence-head">
          <div><b>${esc(competency(r.dimension).name)}</b><span>${esc(SOURCE_NAMES[r.source] || r.source)} · ${esc(r.observer)}</span></div>
          <time>${esc(r.date)}</time>
        </div>
        <p>${esc(r.evidence)}</p>
      </div>
      <button class="icon-btn danger" aria-label="删除这条观察记录" title="删除记录" onclick="delAssessment('${r.id}','${e.id}')">
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 11H8L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z"/></svg>
      </button>
    </article>`).join('') : '<div class="empty compact">还没有观察记录。先记录一个具体事件，画像才会开始形成。</div>';
  openModal(`
    <div class="modal-title-row">
      <div><div class="eyebrow">TALENT PROFILE</div><h2>${esc(e.name)}的人才画像</h2></div>
      <button class="icon-btn" aria-label="关闭" onclick="closeModal()">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="m7.4 6 4.6 4.6L16.6 6 18 7.4 13.4 12l4.6 4.6-1.4 1.4-4.6-4.6L7.4 18 6 16.6l4.6-4.6L6 7.4 7.4 6Z"/></svg>
      </button>
    </div>
    <div class="profile-identity">
      <div class="photo large">${e.photo ? `<img src="${esc(e.photo)}" alt="${esc(e.name)}的头像">` : `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0H5Z"/></svg>`}</div>
      <div><h3>${esc(e.name)}</h3><p>${esc(e.department || '未分配')} · ${esc(e.position || '未设置职位')}</p></div>
      <div class="profile-kpis"><span><b>${p.overall === null ? '—' : p.overall.toFixed(1)}</b>综合</span><span><b>${p.records.length}</b>证据</span><span><b>${p.observers}</b>评价人</span><span title="可信度 ${p.confidenceScore} 分｜样本 ${p.confidenceParts.sample}% · 维度覆盖 ${p.confidenceParts.coverage}% · 评价人 ${p.confidenceParts.observers}%"><b>${p.confidence}</b>可信度</span></div>
    </div>
    <div class="profile-summary-box"><span>角色画像</span><p>${esc(e.roleSummary || '尚未填写。建议描述这个人最适合承担的任务类型和工作环境。')}</p></div>
    ${p.stale ? `<div class="stale-hint">最近 ${PROFILE_OPTIONS.stalenessDays} 天没有新证据，画像可能过时，建议安排一次观察</div>` : ''}
    <div class="profile-layout">
      <section class="profile-section">
        <div class="section-heading"><div><h3>六维能力</h3><p>1～5 分，分数经贝叶斯收缩校准：证据越少越接近 3 分，原始均分见每维下方</p></div><button class="btn small" onclick="editAssessment('${e.id}')">新增观察</button></div>
        <div class="profile-scores">${scoreRows}</div>
      </section>
      <aside class="profile-side">
        <section class="profile-section"><h3>专业技能</h3><div class="skill-list">${skillTags}</div></section>
        <section class="profile-section score-guide"><h3>评分口径</h3><ol><li><b>1</b> 需要持续指导</li><li><b>2</b> 尚不稳定</li><li><b>3</b> 可以独立完成</li><li><b>4</b> 稳定优秀</li><li><b>5</b> 可以指导他人</li></ol></section>
      </aside>
    </div>
    <section class="profile-section evidence-section">
      <div class="section-heading"><div><h3>事实与观察</h3><p>按时间倒序保留评分依据</p></div></div>
      <div class="evidence-list">${timeline}</div>
    </section>`, 'profile-modal');
};

window.editAssessment = function (empId = '') {
  if (!state.employees.length) return toast('请先新增员工');
  const selected = empId || state.employees[0].id;
  const today = new Date().toISOString().slice(0, 10);
  openModal(`
    <div class="modal-title-row"><div><div class="eyebrow">ADD EVIDENCE</div><h2>记录一次工作观察</h2></div><button class="icon-btn" aria-label="关闭" onclick="closeModal()"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="m7.4 6 4.6 4.6L16.6 6 18 7.4 13.4 12l4.6 4.6-1.4 1.4-4.6-4.6L7.4 18 6 16.6l4.6-4.6L6 7.4 7.4 6Z"/></svg></button></div>
    <p class="modal-lead">记录具体发生了什么，再给出评分。避免使用“能力不错”这类无法验证的结论。</p>
    <div class="form assessment-form">
      <label>员工 *<select id="a-emp">${state.employees.map((e) => `<option value="${e.id}" ${e.id === selected ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>
      <label>日期 *<input id="a-date" type="date" value="${today}"></label>
      <label>能力维度 *<select id="a-dimension">${COMPETENCIES.map((d) => `<option value="${d.id}">${esc(d.name)}｜${esc(d.description)}</option>`).join('')}</select></label>
      <label>证据来源 *<select id="a-source"><option value="manager">主管观察</option><option value="result">工作结果</option><option value="peer">同事反馈</option><option value="self">员工自评</option></select></label>
      <label>评分 *<select id="a-score"><option value="3">3｜可以独立完成</option><option value="4">4｜稳定优秀</option><option value="5">5｜可以指导他人</option><option value="2">2｜尚不稳定</option><option value="1">1｜需要持续指导</option></select></label>
      <label>评价人 *<input id="a-observer" value="管理员" maxlength="30"></label>
      <label class="full">具体事实或工作结果 *<textarea id="a-evidence" rows="4" maxlength="500" aria-describedby="a-evidence-help a-evidence-error" placeholder="例如：在客户上线前发现数据风险，主动制定回滚方案，最终按期交付。"></textarea><span class="field-helper" id="a-evidence-help">至少 6 个字。描述行为和结果，不评价性格。</span><span class="field-error" id="a-evidence-error" role="alert" hidden>请填写至少 6 个字的具体事实或工作结果</span></label>
      <div class="actions"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="a-save" onclick="saveAssessment()">保存观察</button></div>
    </div>`);
  $('#a-evidence').addEventListener('input', (event) => {
    if (event.target.value.trim().length < 6) return;
    event.target.removeAttribute('aria-invalid');
    $('#a-evidence-error').hidden = true;
  });
};

window.saveAssessment = async function () {
  const evidence = $('#a-evidence').value.trim();
  if (evidence.length < 6) {
    $('#a-evidence').setAttribute('aria-invalid', 'true');
    $('#a-evidence-error').hidden = false;
    $('#a-evidence').focus();
    return;
  }
  const saveButton = $('#a-save');
  saveButton.disabled = true;
  saveButton.textContent = '保存中…';
  try {
    const empId = $('#a-emp').value;
    await api('/api/assessments', 'POST', {
      empId,
      date: $('#a-date').value,
      dimension: $('#a-dimension').value,
      source: $('#a-source').value,
      score: Number($('#a-score').value),
      observer: $('#a-observer').value,
      evidence,
    });
    closeModal();
    await refresh();
    viewTalentProfile(empId);
    toast('观察已记录，画像已更新');
  } catch (err) {
    saveButton.disabled = false;
    saveButton.textContent = '保存观察';
    toast(err.message);
  }
};

window.delAssessment = async function (id, empId) {
  if (!confirm('确定删除这条观察记录吗？员工画像将重新计算。')) return;
  try {
    await api(`/api/assessments/${id}`, 'DELETE');
    await refresh();
    viewTalentProfile(empId);
    toast('观察记录已删除');
  } catch (err) { toast(err.message); }
};

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
      <label class="full">角色画像<textarea id="f-role" rows="2" maxlength="180" placeholder="这个人最适合承担哪类任务？在什么环境下表现最好？">${esc(e.roleSummary || '')}</textarea></label>
      <label class="full">专业技能<input id="f-skills" value="${esc((e.skills || []).join('、'))}" placeholder="用逗号或顿号分隔，如：客户实施、项目推进、需求澄清"><span class="field-helper">最多保留 12 项技能标签</span></label>
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
    roleSummary: $('#f-role').value,
    skills: $('#f-skills').value.split(/[，,、]/).map((x) => x.trim()).filter(Boolean).slice(0, 12),
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
  if (!confirm(`确定删除「${empName(id)}」吗？其观察、薪酬与差旅记录也会一并删除。`)) return;
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

// ================= 视图：设备采买 =================
const EQUIPMENT_CATEGORIES = ['电脑设备', '办公设备', '测试设备', '网络设备', '其他'];

function viewEquipment() {
  if (!state.equipmentApiAvailable) {
    return `<div class="panel">
      <h2>设备采买服务尚未加载</h2>
      <div class="service-notice" role="status">原有员工、薪酬和差旅数据不受影响。请重新启动员工管理系统后再记录设备采买。</div>
    </div>`;
  }
  const rows = state.equipment
    .filter((r) => r.date.startsWith(String(state.year)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalQty = rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  const trs = rows.map((r) => `<tr>
    <td>${esc(r.date)}</td>
    <td><b>${esc(r.name)}</b></td>
    <td>${esc(r.category || '其他')}</td>
    <td class="num">${fmt(r.quantity)}</td>
    <td class="num">${fmt(r.unitPrice)}</td>
    <td class="num pos">${fmt(r.amount)}</td>
    <td>${esc(r.vendor || '—')}</td>
    <td class="note-cell">${esc(r.note || '—')}</td>
    <td class="row-actions">
      <button class="btn small" onclick="editEquipment('${r.id}')">编辑</button>
      <button class="btn small danger" onclick="delEquipment('${r.id}')">删除</button>
    </td>
  </tr>`).join('');
  return `
    <div class="toolbar">
      <button class="btn primary" onclick="editEquipment()">＋ 记录设备采买</button>
      <span class="hint">${state.year}年共 ${rows.length} 笔 · ${fmt(totalQty)} 件 · 设备采买总额：¥${fmt(total)}</span>
    </div>
    <div class="panel">
      <h2>设备采买明细</h2>
      <div class="table-scroll"><table class="wide-table equipment-table">
        <thead><tr><th scope="col">日期</th><th scope="col">设备名称</th><th scope="col">分类</th><th scope="col" class="num">数量</th><th scope="col" class="num">单价</th><th scope="col" class="num">成本金额</th><th scope="col">供应商/渠道</th><th scope="col">备注</th><th scope="col" class="action-head">操作</th></tr></thead>
        <tbody>${trs || `<tr><td colspan="9" class="empty">${state.year}年暂无设备采买记录，点击「记录设备采买」添加</td></tr>`}</tbody>
        ${trs ? `<tfoot><tr><td colspan="3">合计</td><td class="num">${fmt(totalQty)}</td><td></td><td class="num pos">¥${fmt(total)}</td><td colspan="3"></td></tr></tfoot>` : ''}
      </table></div>
    </div>`;
}

/** 新增/编辑设备采买记录 */
window.editEquipment = function (id) {
  if (!state.equipmentApiAvailable) return toast('请先重新启动员工管理系统，再使用设备采买功能');
  const rec = id ? state.equipment.find((r) => r.id === id) : null;
  const today = new Date();
  const defaultDate = `${state.year}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const category = rec?.category || EQUIPMENT_CATEGORIES[0];
  openModal(`
    <h3>${rec ? '编辑设备采买' : '记录设备采买'} · ${state.year}年</h3>
    <div class="form">
      <label>设备名称 *<input id="e-name" value="${esc(rec?.name || '')}" placeholder="如：笔记本电脑"></label>
      <label>采买日期 *<input id="e-date" type="date" value="${esc(rec?.date || defaultDate)}"></label>
      <label>设备分类
        <select id="e-category">${EQUIPMENT_CATEGORIES.map((c) => `<option value="${c}" ${c === category ? 'selected' : ''}>${c}</option>`).join('')}</select>
      </label>
      <label>数量 *<input id="e-quantity" type="number" step="1" min="1" value="${rec?.quantity ?? 1}"></label>
      <label>单价（元）*<input id="e-unit-price" type="number" step="0.01" min="0" value="${rec?.unitPrice ?? ''}" placeholder="如：5999"></label>
      <label>供应商/渠道<input id="e-vendor" value="${esc(rec?.vendor || '')}" placeholder="如：京东、设备供应商"></label>
      <label class="full">备注<textarea id="e-note" rows="2" placeholder="型号、用途、订单号等">${esc(rec?.note || '')}</textarea></label>
      <div class="full cost-preview" aria-live="polite">
        <span>本笔设备成本</span><strong id="e-total">¥${fmt(rec?.amount || 0)}</strong>
      </div>
      <div class="actions">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn primary" onclick="saveEquipment('${id || ''}')">保存</button>
      </div>
    </div>`);
  const updateTotal = () => {
    const quantity = Math.max(1, Math.floor(Number($('#e-quantity').value) || 1));
    const unitPrice = Math.max(0, Number($('#e-unit-price').value) || 0);
    $('#e-total').textContent = `¥${fmt(round2(quantity * unitPrice))}`;
  };
  $('#e-quantity').addEventListener('input', updateTotal);
  $('#e-unit-price').addEventListener('input', updateTotal);
};

window.saveEquipment = async function (id) {
  const body = {
    name: $('#e-name').value,
    date: $('#e-date').value,
    category: $('#e-category').value,
    quantity: $('#e-quantity').value,
    unitPrice: $('#e-unit-price').value,
    vendor: $('#e-vendor').value,
    note: $('#e-note').value,
  };
  if (!body.name.trim()) return toast('设备名称必填');
  if (!body.date) return toast('采买日期必填');
  if (!(Number(body.quantity) >= 1)) return toast('数量至少为 1');
  if (!(Number(body.unitPrice) >= 0) || body.unitPrice === '') return toast('请填写设备单价');
  try {
    if (id) await api(`/api/equipment/${id}`, 'PUT', body);
    else await api('/api/equipment', 'POST', body);
    closeModal();
    toast(id ? '设备采买已更新' : '设备采买已记录');
    await refresh();
  } catch (err) { toast(err.message); }
};

window.delEquipment = async function (id) {
  if (!confirm('删除这条设备采买记录？')) return;
  await api(`/api/equipment/${id}`, 'DELETE');
  toast('已删除');
  await refresh();
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
  const equipment = equipmentSum(y);
  const companyTotal = tot.total + equipment;

  // 月度趋势（薪酬实发 + 差旅 + 设备采买）
  const mm = (m) => String(m).padStart(2, '0');
  const monthly = MONTHS.map((m) => {
    const sal = state.salary
      .filter((r) => r.year === y && r.month === m)
      .reduce((s, r) => s + r.base + r.merit + r.bonus - r.deduct, 0);
    const tv = state.travel
      .filter((r) => r.date.startsWith(`${y}-${mm(m)}`))
      .reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const eq = state.equipment
      .filter((r) => r.date.startsWith(`${y}-${mm(m)}`))
      .reduce((s, r) => s + (Number(r.amount) || 0), 0);
    return { m, sal, tv, eq, all: sal + tv + eq };
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
      <div class="kpi highlight"><div class="v">¥${fmt(companyTotal)}</div><div class="t">${y}年总成本（薪酬+差旅+设备）</div></div>
      <div class="kpi"><div class="v">¥${fmt(tot.base)}</div><div class="t">固定月薪合计</div></div>
      <div class="kpi"><div class="v">¥${fmt(tot.merit)}</div><div class="t">绩效合计</div></div>
      <div class="kpi"><div class="v">¥${fmt(tot.bonus)}</div><div class="t">奖金合计</div></div>
      <div class="kpi"><div class="v">¥${fmt(tot.deduct)}</div><div class="t">扣款合计</div></div>
      <div class="kpi"><div class="v">¥${fmt(tot.base + tot.merit + tot.bonus - tot.deduct)}</div><div class="t">薪酬实发合计</div></div>
      <div class="kpi"><div class="v">¥${fmt(tot.travel)}</div><div class="t">差旅合计</div></div>
      <div class="kpi"><div class="v">¥${fmt(equipment)}</div><div class="t">设备采买合计</div></div>
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
      <div class="panel"><h2>部门人力成本占比（薪酬+差旅）</h2>
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
                <div class="dept-track" role="img" aria-label="${esc(d)}占员工年度成本${pct.toFixed(1)}%">
                  <span class="dept-fill" style="width:${pct}%;background:${color}"></span>
                </div>
              </div>`;
            }).join('')}
          </div>` : `<div class="empty">暂无数据</div>`}
      </div>
    </div>
    <div class="panel">
      <h2>员工年度成本排行（${y}，薪酬+差旅）</h2>
      <div class="table-scroll"><table class="wide-table report-table">
        <thead><tr><th scope="col">#</th><th scope="col">员工</th><th scope="col">部门</th><th scope="col" class="num">月薪</th><th scope="col" class="num">绩效</th><th scope="col" class="num">奖金</th><th scope="col" class="num">扣款</th><th scope="col" class="num">薪酬实发</th><th scope="col" class="num">差旅</th><th scope="col" class="num">员工年度成本</th></tr></thead>
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
        <span class="hint">公司年度总成本另含设备采买 ¥${fmt(equipment)}</span>
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
  const equipmentRows = state.equipment
    .filter((r) => r.date.startsWith(String(y)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const equipmentTotal = equipmentRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const employeeTotal = tot[9];
  const csv = [
    [`员工年度成本核算报表 ${y}年`],
    ['姓名', '部门', '职位', '月薪合计', '绩效合计', '奖金合计', '扣款合计', '薪酬实发', '差旅合计', '年度总成本'],
    ...rows,
    ['合计', '', '', ...tot.slice(3)],
    [],
    [`公司年度总成本（员工成本 + 设备采买）：${employeeTotal + equipmentTotal}`],
    [],
    [`设备采买明细 ${y}年`],
    ['日期', '设备名称', '分类', '数量', '单价', '成本金额', '供应商/渠道', '备注'],
    ...equipmentRows.map((r) => [r.date, r.name, r.category, r.quantity, r.unitPrice, r.amount, r.vendor, r.note]),
    ['设备采买合计', '', '', '', '', equipmentTotal, '', ''],
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
let modalLastFocus = null;
function openModal(html, className = '') {
  closeModal();
  modalLastFocus = document.activeElement;
  const mask = document.createElement('div');
  mask.className = 'mask';
  mask.id = 'mask';
  mask.innerHTML = `<div class="modal ${esc(className)}" role="dialog" aria-modal="true">${html}</div>`;
  mask.addEventListener('click', (e) => { if (e.target === mask) closeModal(); });
  mask.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return closeModal();
    if (e.key !== 'Tab') return;
    const items = [...mask.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!items.length) return;
    const first = items[0]; const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  document.body.appendChild(mask);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => mask.querySelector('input, select, textarea, button')?.focus());
}
window.closeModal = function () {
  const mask = $('#mask');
  if (!mask) return;
  mask.remove();
  document.body.classList.remove('modal-open');
  if (modalLastFocus?.isConnected) modalLastFocus.focus();
};

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
  const views = { cards: viewCards, salary: viewSalary, travel: viewTravel, equipment: viewEquipment, report: viewReport };
  $('#app').innerHTML = views[state.tab]();
  $('.yearbox').hidden = state.tab === 'cards';
  $('#settingsBtn').hidden = state.tab !== 'salary';
}

async function refresh() {
  // 兼容仍在运行的旧版后台：设备接口未加载时，不能阻断原有数据页面初始化。
  const equipmentRequest = api('/api/equipment')
    .then((data) => ({ data, available: true }))
    .catch((err) => {
      if (err.message === 'unknown api') return { data: [], available: false };
      throw err;
    });
  const [employees, salary, travel, equipmentResult, settings, assessments] = await Promise.all([
    api('/api/employees'), api('/api/salary'), api('/api/travel'), equipmentRequest, api('/api/settings'), api('/api/assessments'),
  ]);
  state.employees = employees;
  state.salary = salary;
  state.travel = travel;
  state.equipment = equipmentResult.data;
  state.equipmentApiAvailable = equipmentResult.available;
  state.settings = settings;
  state.assessments = assessments;
  initYearSel();
  render();
}

refresh().catch((err) => {
  $('#app').innerHTML = `<div class="panel"><div class="empty">数据加载失败：${esc(err.message)}。请重新启动员工管理系统后刷新页面。</div></div>`;
});
