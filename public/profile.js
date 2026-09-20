/**
 * 人才画像核心算法（纯函数，无浏览器/Node 依赖）
 *
 * 设计原则：
 *   1. 可解释性优先——每个派生数字都能回溯到原始证据
 *   2. 保守优于冒进——证据不足时显示"样本不足"，不贴标签
 *   3. 纯函数——同样输入必得同样输出；时间基准 now 由参数传入，可用 node:test 单测
 *
 * 算法详见 docs/profile-algorithm.md
 *
 * 浏览器端挂载为 window.ProfileMath；Node 端可 require 用于测试。
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  root.ProfileMath = lib;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const DAY_MS = 86400000;

  /** 默认参数（应用侧可通过 options 覆盖） */
  const DEFAULTS = {
    // 贝叶斯先验：相当于 k 条 μ₀ 分的虚拟证据
    prior: { mean: 3, strength: 3 },
    // 优势线（作用于收缩分）；关注方向为 < 该值
    strengthLine: 3.5,
    // 优势/关注方向的最低证据条数，低于此值显示"样本不足"（按真实条数计，不看衰减）
    minEvidence: 2,
    // 盲区提示：自评与他评差距阈值、所需最少他评条数
    blindspotGap: 1,
    blindspotMinOther: 2,
    // 可信度三因子：样本目标条数、评价人目标数、权重、分级线
    confidence: {
      sampleTarget: 12,
      observerTarget: 3,
      wSample: 0.4,
      wCoverage: 0.3,
      wObservers: 0.3,
      stages: [30, 55, 80], // [待建立, 初步画像, 形成中] 上界，≥80 较稳定
    },
    // 时间衰减：w = 0.5^(距今天数 / halfLifeDays)，半年半衰期
    decay: { halfLifeDays: 180 },
    // 近 90 天趋势：窗口天数、箭头所需两侧最少条数、箭头最小差距
    trend: { windowDays: 90, minSide: 2, arrowThreshold: 0.5 },
    // 最新证据超过该天数则提示画像可能过时
    stalenessDays: 180,
    // 时间基准（ISO 字符串或毫秒时间戳）；undefined 时取当前时间
    now: undefined,
  };

  function mergeOptions(options) {
    const o = options || {};
    return {
      prior: { ...DEFAULTS.prior, ...(o.prior || {}) },
      strengthLine: o.strengthLine !== undefined ? o.strengthLine : DEFAULTS.strengthLine,
      minEvidence: o.minEvidence !== undefined ? o.minEvidence : DEFAULTS.minEvidence,
      blindspotGap: o.blindspotGap !== undefined ? o.blindspotGap : DEFAULTS.blindspotGap,
      blindspotMinOther: o.blindspotMinOther !== undefined ? o.blindspotMinOther : DEFAULTS.blindspotMinOther,
      confidence: { ...DEFAULTS.confidence, ...(o.confidence || {}) },
      decay: { ...DEFAULTS.decay, ...(o.decay || {}) },
      trend: { ...DEFAULTS.trend, ...(o.trend || {}) },
      stalenessDays: o.stalenessDays !== undefined ? o.stalenessDays : DEFAULTS.stalenessDays,
      now: o.now !== undefined ? o.now : DEFAULTS.now,
    };
  }

  const round2 = (n) => Math.round(n * 100) / 100;
  const mean = (list) => (list.length ? list.reduce((s, x) => s + Number(x), 0) / list.length : null);

  function parseTime(v) {
    if (v === undefined || v === null) return null;
    const t = typeof v === 'number' ? v : Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }

  /** 解析失败按 0 天（当天）处理；未来日期钳制为 0，避免超权 */
  function ageDays(date, now) {
    const t = parseTime(date);
    if (t === null) return 0;
    return Math.max(0, (now - t) / DAY_MS);
  }

  function resolveNow(now) {
    return parseTime(now) ?? Date.now();
  }

  /** 时间衰减权重：w = 0.5^(天数 / 半衰期) */
  function weight(age, halfLifeDays) {
    return Math.pow(0.5, age / halfLifeDays);
  }

  /**
   * 贝叶斯收缩（v2，无时间维度）：score* = (Σs + k·μ₀) / (n + k)
   * 即"证据均分"与"先验均值"按 n : k 加权平均。无证据时返回 null。
   */
  function shrink(scores, prior) {
    const n = scores.length;
    if (!n) return null;
    const p = prior || DEFAULTS.prior;
    const sum = scores.reduce((s, x) => s + Number(x), 0);
    return round2((sum + p.strength * p.mean) / (n + p.strength));
  }

  /**
   * 盲区检测：自评与他评同时存在、他评 ≥2 条、差距 ≥ 阈值时返回提示对象。
   * 返回 { gap, direction }（gap = 自评 − 他评，保留两位小数），否则 null。
   */
  function blindspot(selfScore, selfN, otherScore, otherN, opts) {
    const o = opts || DEFAULTS;
    if (selfScore === null || otherScore === null) return null;
    if (otherN < o.blindspotMinOther) return null;
    const gap = round2(selfScore - otherScore);
    if (Math.abs(gap) < o.blindspotGap) return null;
    return { gap, direction: gap > 0 ? 'self-higher' : 'other-higher' };
  }

  /**
   * 可信度三因子：样本量、维度覆盖、评价人多样性，加权得 0~100 分。
   * 输入为聚合后的计数，返回 { score, label, parts }，parts 为三个子指标百分比。
   */
  function confidenceOf(counts, conf) {
    const c = conf || DEFAULTS.confidence;
    const sample = Math.min(counts.recordCount / c.sampleTarget, 1);
    const coverage = counts.dimensionTotal ? counts.ratedCount / counts.dimensionTotal : 0;
    const observers = Math.min(counts.observerCount / c.observerTarget, 1);
    const score = round2(100 * (c.wSample * sample + c.wCoverage * coverage + c.wObservers * observers));
    const [s1, s2, s3] = c.stages;
    const label = score < s1 ? '待建立' : score <= s2 ? '初步画像' : score < s3 ? '形成中' : '较稳定';
    const pct = (x) => Math.round(x * 100);
    return { score, label, parts: { sample: pct(sample), coverage: pct(coverage), observers: pct(observers) } };
  }

  /**
   * 近 90 天趋势：窗口内均分 vs 窗口前基线。只播报事实，不影响分数。
   * 窗口 ≥1 条才显示；两侧各 ≥ minSide 条时计算 delta；|delta| ≥ arrowThreshold 才给箭头。
   */
  function trendOf(winItems, oldItems, t) {
    if (!winItems.length) return null;
    const recentMean = round2(mean(winItems.map((r) => r.score)));
    const baselineMean = oldItems.length ? round2(mean(oldItems.map((r) => r.score))) : null;
    const out = {
      recentN: winItems.length,
      recentMean,
      baselineN: oldItems.length,
      baselineMean,
      delta: null,
      arrow: null,
    };
    if (winItems.length >= t.minSide && oldItems.length >= t.minSide) {
      const delta = round2(recentMean - baselineMean);
      out.delta = delta;
      if (Math.abs(delta) >= t.arrowThreshold) out.arrow = delta > 0 ? 'up' : 'down';
    }
    return out;
  }

  /**
   * 由原始观察记录构建人才画像。
   *
   * @param {Array}  records   该员工的观察记录（任意顺序，函数内按日期倒序）
   * @param {Array}  comps     能力维度定义 [{ id, name, short, description }]
   * @param {Object} options   可选，覆盖 DEFAULTS 中的参数（含 now 时间基准）
   * @returns 画像对象（dimensions/strengths/development/insufficient/confidence/trend/stale 等）
   */
  function buildProfile(records, comps, options) {
    const opts = mergeOptions(options);
    const now = resolveNow(opts.now);
    const halfLife = opts.decay.halfLifeDays;
    const wOf = (r) => weight(ageDays(r.date, now), halfLife);
    const sorted = [...records].sort((a, b) =>
      String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));

    const dimensions = comps.map((c) => {
      const items = sorted.filter((r) => r.dimension === c.id);
      const selfItems = items.filter((r) => r.source === 'self');
      const otherItems = items.filter((r) => r.source !== 'self');
      const selfScore = mean(selfItems.map((r) => r.score));
      const otherScore = mean(otherItems.map((r) => r.score));
      // 时间衰减：Σw 为有效证据量 n_eff，旧证据双重衰减（分子占比小 + 先验话语权回升）
      let wSum = 0;
      let wsSum = 0;
      for (const r of items) {
        const w = wOf(r);
        wSum += w;
        wsSum += w * Number(r.score);
      }
      const winItems = [];
      const oldItems = [];
      for (const r of items) {
        (ageDays(r.date, now) <= opts.trend.windowDays ? winItems : oldItems).push(r);
      }
      return {
        ...c,
        items,
        n: items.length,
        nEff: round2(wSum),
        rawScore: mean(items.map((r) => r.score)),
        decayedMean: wSum > 0 ? round2(wsSum / wSum) : null,
        score: wSum > 0 ? round2((wsSum + opts.prior.strength * opts.prior.mean) / (wSum + opts.prior.strength)) : null,
        selfN: selfItems.length,
        selfScore,
        otherN: otherItems.length,
        otherScore,
        blindspot: blindspot(selfScore, selfItems.length, otherScore, otherItems.length, opts),
        trend: trendOf(winItems, oldItems, opts.trend),
        insufficient: items.length > 0 && items.length < opts.minEvidence,
      };
    });

    const eligible = dimensions.filter((d) => !d.insufficient && d.score !== null);
    const strengths = eligible.filter((d) => d.score >= opts.strengthLine)
      .sort((a, b) => b.score - a.score || b.n - a.n).slice(0, 3);
    const development = eligible.filter((d) => d.score < opts.strengthLine)
      .sort((a, b) => a.score - b.score || b.n - a.n).slice(0, 2);
    const insufficient = dimensions.filter((d) => d.insufficient);

    const observerCount = new Set(sorted.map((r) => r.observer).filter(Boolean)).size;
    const confidence = confidenceOf({
      recordCount: sorted.length,
      ratedCount: dimensions.filter((d) => d.score !== null).length,
      dimensionTotal: comps.length,
      observerCount,
    }, opts.confidence);

    let owSum = 0;
    let owsSum = 0;
    for (const r of sorted) {
      const w = wOf(r);
      owSum += w;
      owsSum += w * Number(r.score);
    }

    const latestAgeDays = sorted.length ? Math.floor(ageDays(sorted[0].date, now)) : null;

    return {
      records: sorted,
      dimensions,
      strengths,
      development,
      insufficient,
      observers: observerCount,
      confidenceScore: confidence.score,
      confidenceLabel: confidence.label,
      confidenceParts: confidence.parts,
      overall: owSum > 0 ? round2((owsSum + opts.prior.strength * opts.prior.mean) / (owSum + opts.prior.strength)) : null,
      rawOverall: mean(sorted.map((r) => r.score)),
      latest: sorted[0] ? sorted[0].date : '',
      latestAgeDays,
      stale: latestAgeDays !== null && latestAgeDays > opts.stalenessDays,
    };
  }

  return { DEFAULTS, shrink, blindspot, confidenceOf, trendOf, buildProfile, mergeOptions, weight, ageDays };
});
