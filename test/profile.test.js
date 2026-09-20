/**
 * 画像算法单测（node:test，零依赖）
 * 运行：node --test test/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const ProfileMath = require('../public/profile.js');

const { shrink, blindspot, confidenceOf, buildProfile } = ProfileMath;

const COMPS = [
  { id: 'ownership', name: '主人翁精神', short: '主人翁', description: '' },
  { id: 'openness', name: '开放心态', short: '开放心态', description: '' },
  { id: 'judgment', name: '逻辑判断', short: '逻辑判断', description: '' },
  { id: 'learning', name: '学习适应', short: '学习适应', description: '' },
  { id: 'execution', name: '执行交付', short: '执行交付', description: '' },
  { id: 'collaboration', name: '协作沟通', short: '协作沟通', description: '' },
];

let seq = 0;
function rec(dimension, score, extra = {}) {
  return {
    id: `t-${++seq}`,
    empId: 'emp-x',
    date: extra.date || '2026-09-01',
    dimension,
    score,
    source: extra.source || 'manager',
    observer: extra.observer || '管理员',
    evidence: '测试用具体事实样例',
    createdAt: extra.createdAt || '2026-09-01T00:00:00.000Z',
  };
}

// ---------- shrink：贝叶斯收缩 ----------

test('shrink：无证据返回 null', () => {
  assert.equal(shrink([]), null);
});

test('shrink：1 条 5 分收缩为 3.5，不被单条证据吹高', () => {
  assert.equal(shrink([5]), 3.5);
});

test('shrink：1 条 4 分收缩为 3.25，回到待验证区间', () => {
  assert.equal(shrink([4]), 3.25);
});

test('shrink：3 条全 4 分恰好 3.5，压线入列', () => {
  assert.equal(shrink([4, 4, 4]), 3.5);
});

test('shrink：3 条全 5 分给到 4.0，敢给高分', () => {
  assert.equal(shrink([5, 5, 5]), 4);
});

test('shrink：3 条全 2 分为 2.5，低分也不一条定罪', () => {
  assert.equal(shrink([2, 2, 2]), 2.5);
});

test('shrink：k=0 时退化为普通平均', () => {
  assert.equal(shrink([5], { mean: 3, strength: 0 }), 5);
});

// ---------- buildProfile：门槛与分类 ----------

test('无任何证据：全维度空、可信度待建立、无分类', () => {
  const p = buildProfile([], COMPS);
  assert.equal(p.overall, null);
  assert.equal(p.confidenceLabel, '待建立');
  assert.equal(p.confidenceScore, 0);
  assert.deepEqual(p.strengths, []);
  assert.deepEqual(p.development, []);
  assert.deepEqual(p.insufficient, []);
  assert.ok(p.dimensions.every((d) => d.score === null && d.n === 0));
});

test('单条 5 分：分数 3.5 但样本不足，不进优势列表', () => {
  const p = buildProfile([rec('judgment', 5)], COMPS, { now: '2026-09-01' });
  const d = p.dimensions.find((x) => x.id === 'judgment');
  assert.equal(d.score, 3.5);
  assert.equal(d.insufficient, true);
  assert.deepEqual(p.strengths, []);
  assert.deepEqual(p.development, []);
  assert.equal(p.insufficient.length, 1);
});

test('3 条全 4 分：收缩 3.5，达到优势线且过门槛，进入优势', () => {
  const p = buildProfile([rec('execution', 4), rec('execution', 4), rec('execution', 4)], COMPS, { now: '2026-09-01' });
  const d = p.dimensions.find((x) => x.id === 'execution');
  assert.equal(d.score, 3.5);
  assert.equal(d.insufficient, false);
  assert.deepEqual(p.strengths.map((x) => x.id), ['execution']);
  assert.deepEqual(p.development, []);
});

test('3 条全 2 分：收缩 2.5，进入关注方向而非优势', () => {
  const p = buildProfile([rec('openness', 2), rec('openness', 2), rec('openness', 2)], COMPS, { now: '2026-09-01' });
  assert.equal(p.dimensions.find((x) => x.id === 'openness').score, 2.5);
  assert.deepEqual(p.development.map((x) => x.id), ['openness']);
  assert.deepEqual(p.strengths, []);
});

test('综合分也做收缩：1 条 4 分 → overall 3.25', () => {
  const p = buildProfile([rec('judgment', 4)], COMPS, { now: '2026-09-01' });
  assert.equal(p.overall, 3.25);
  assert.equal(p.rawOverall, 4);
});

test('乱序记录按日期倒序返回，latest 为最新日期', () => {
  const p = buildProfile([
    rec('judgment', 3, { date: '2026-08-01', createdAt: '2026-08-01T00:00:00.000Z' }),
    rec('execution', 4, { date: '2026-09-10', createdAt: '2026-09-10T00:00:00.000Z' }),
  ], COMPS);
  assert.equal(p.records[0].date, '2026-09-10');
  assert.equal(p.latest, '2026-09-10');
});

// ---------- 可信度三因子 ----------

test('张三场景：3 条证据、3 维覆盖、3 位评价人 → 55 分初步画像', () => {
  const p = buildProfile([
    rec('judgment', 4, { source: 'result', observer: '项目负责人' }),
    rec('execution', 4, { source: 'manager', observer: '管理员' }),
    rec('collaboration', 3, { source: 'peer', observer: '同事反馈' }),
  ], COMPS);
  assert.equal(p.confidenceScore, 55);
  assert.equal(p.confidenceLabel, '初步画像');
  assert.deepEqual(p.confidenceParts, { sample: 25, coverage: 50, observers: 100 });
});

test('三因子全满：12 条、6 维、3 评价人 → 100 分较稳定', () => {
  const r = confidenceOf({ recordCount: 12, ratedCount: 6, dimensionTotal: 6, observerCount: 3 });
  assert.equal(r.score, 100);
  assert.equal(r.label, '较稳定');
});

test('记录数相同但维度单一：可信度明显更低', () => {
  const many = confidenceOf({ recordCount: 12, ratedCount: 1, dimensionTotal: 6, observerCount: 1 });
  const spread = confidenceOf({ recordCount: 12, ratedCount: 6, dimensionTotal: 6, observerCount: 3 });
  assert.ok(many.score < spread.score);
});

// ---------- 盲区提示 ----------

test('盲区：自评 5、两条他评均 3 → 提示自评偏高 2 分', () => {
  const p = buildProfile([
    rec('ownership', 5, { source: 'self', observer: '本人' }),
    rec('ownership', 3, { source: 'manager', observer: '主管A' }),
    rec('ownership', 3, { source: 'peer', observer: '主管B' }),
  ], COMPS);
  const d = p.dimensions.find((x) => x.id === 'ownership');
  assert.deepEqual(d.blindspot, { gap: 2, direction: 'self-higher' });
});

test('盲区：他评只有 1 条时不提示（样本不够）', () => {
  const p = buildProfile([
    rec('ownership', 5, { source: 'self', observer: '本人' }),
    rec('ownership', 2, { source: 'manager', observer: '主管A' }),
  ], COMPS);
  assert.equal(p.dimensions.find((x) => x.id === 'ownership').blindspot, null);
});

test('盲区：差距 0.5 分（不足阈值）不提示', () => {
  const p = buildProfile([
    rec('ownership', 4, { source: 'self', observer: '本人' }),
    rec('ownership', 4, { source: 'manager', observer: '主管A' }),
    rec('ownership', 3, { source: 'peer', observer: '主管B' }),
  ], COMPS);
  assert.equal(p.dimensions.find((x) => x.id === 'ownership').blindspot, null);
});

test('blindspot 纯函数：他评更高时方向为 other-higher', () => {
  const r = blindspot(2, 1, 4, 2);
  assert.deepEqual(r, { gap: -2, direction: 'other-higher' });
});

// ---------- v3：时间衰减与近 90 天趋势 ----------

const NOW3 = '2026-09-17';
const v3 = (recs) => buildProfile(recs, COMPS, { now: NOW3 });

test('衰减：新证据话语权高于旧证据（v2 会给 4.0，v3 拉低）', () => {
  const p = v3([
    rec('judgment', 5, { date: '2026-09-07' }),   // 10 天前
    rec('judgment', 2, { date: '2025-11-19' }),   // 约 302 天前
  ]);
  const d = p.dimensions.find((x) => x.id === 'judgment');
  assert.ok(d.nEff > 1 && d.nEff < 1.4);          // 旧证据折算成不到半条
  assert.ok(Math.abs(d.score - 3.38) < 0.01);
});

test('衰减：陈旧的高分证据自然失去优势资格，且标记陈旧', () => {
  const p = v3([
    rec('ownership', 5, { date: '2025-08-13' }),  // 约 400 天前
    rec('ownership', 5, { date: '2025-05-05' }),  // 约 500 天前
  ]);
  const d = p.dimensions.find((x) => x.id === 'ownership');
  assert.equal(d.n, 2);                            // 门槛按真实条数，仍通过
  assert.ok(d.score < 3.5);                        // 但分数已褪色，不进优势
  assert.deepEqual(p.strengths, []);
  assert.equal(p.stale, true);
  assert.equal(p.latestAgeDays, 400);
});

test('边界：未来日期按当天处理，权重不超 1', () => {
  const p = v3([rec('judgment', 4, { date: '2027-01-01' })]);
  const d = p.dimensions.find((x) => x.id === 'judgment');
  assert.equal(d.nEff, 1);
  assert.equal(d.score, 3.25);                     // 与全新证据一致
});

test('趋势：近90天 2 条 4 分 vs 之前 2 条 3 分 → delta 1，显示上升箭头', () => {
  const p = v3([
    rec('execution', 4, { date: '2026-09-10' }),
    rec('execution', 4, { date: '2026-09-07' }),
    rec('execution', 3, { date: '2026-05-01' }),
    rec('execution', 3, { date: '2026-04-01' }),
  ]);
  const t = p.dimensions.find((x) => x.id === 'execution').trend;
  assert.equal(t.recentMean, 4);
  assert.equal(t.baselineMean, 3);
  assert.equal(t.delta, 1);
  assert.equal(t.arrow, 'up');
});

test('箭头阈值：delta 0.25 只记录差距，不显示箭头', () => {
  const p = v3([
    rec('execution', 4, { date: '2026-09-10' }),
    rec('execution', 4, { date: '2026-09-07' }),
    rec('execution', 4, { date: '2026-05-01' }),
    rec('execution', 4, { date: '2026-04-01' }),
    rec('execution', 4, { date: '2026-03-01' }),
    rec('execution', 3, { date: '2026-02-01' }),
  ]);
  const t = p.dimensions.find((x) => x.id === 'execution').trend;
  assert.equal(t.recentMean, 4);
  assert.equal(t.baselineMean, 3.75);
  assert.equal(t.delta, 0.25);
  assert.equal(t.arrow, null);
});

test('趋势窗口边界：恰好 90 天算窗口内', () => {
  const p = v3([rec('learning', 4, { date: '2026-06-19' })]);
  const t = p.dimensions.find((x) => x.id === 'learning').trend;
  assert.equal(t.recentN, 1);
  assert.equal(t.recentMean, 4);
});

test('无窗口证据：trend 为 null，同时标记陈旧', () => {
  const p = v3([rec('learning', 4, { date: '2026-01-01' })]);
  const d = p.dimensions.find((x) => x.id === 'learning');
  assert.equal(d.trend, null);
  assert.equal(p.stale, true);
});

test('新鲜数据不标记陈旧', () => {
  const p = v3([rec('learning', 4, { date: '2026-09-10' })]);
  assert.equal(p.stale, false);
  assert.equal(p.latestAgeDays, 7);
});
