// Sample-size calculations for developing clinical prediction models.
// A JavaScript port of the R package pmsampsize 1.1.3 (Ensor, Martin, Riley; GPL >= 3)
// for time-to-event ("s") and binary ("b") outcomes, plus helpers that turn
// published model statistics into an anticipated R² (Riley et al., Stat Med 2019;38:1276-96).
//
// Functions marked "mirrors pmsampsize" reproduce the R code's operation order and
// rounding so results match it exactly. cstatToR2Binary is a deterministic approximation
// of pmsampsize's simulation-based cstat2rsq() and can differ in the 4th decimal.

/** R's round(x, digits) for the magnitudes used here. */
export const roundTo = (x, digits) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

// ---------------------------------------------------------------------------
// Maximum Cox-Snell R² (Riley et al. eq. 23) from the null log-likelihood
// ---------------------------------------------------------------------------

/** ln L_null for an exponential survival model as pmsampsize writes it: E ln(E/n) − E. */
export const lnLnullSurvival = (events, n) => events * Math.log(events / n) - events;

/** ln L_null for a logistic model: E ln(E/n) + (n − E) ln(1 − E/n). */
export const lnLnullBinary = (events, n) =>
  events * Math.log(events / n) + (n - events) * Math.log(1 - events / n);

export const maxR2cs = (lnLnull, n) => 1 - Math.exp((2 * lnLnull) / n);

// ---------------------------------------------------------------------------
// pmsampsize(): input checks and Nagelkerke -> Cox-Snell conversion (mirrors pmsampsize)
// ---------------------------------------------------------------------------

export class InputError extends Error {}

/**
 * Required sample size for one candidate-parameter count.
 * @param {object} a
 * @param {"s"|"b"} a.type
 * @param {number} [a.nagrsquared]  anticipated Nagelkerke R²
 * @param {number} [a.csrsquared]   anticipated (optimism-adjusted) Cox-Snell R²
 * @param {number} a.parameters     candidate predictor parameters
 * @param {number} [a.shrinkage=0.9]
 * @param {number} [a.rate]         survival: events per person-time
 * @param {number} [a.meanfup]      survival: mean follow-up (same time unit as rate)
 * @param {number} [a.timepoint]    survival: prediction horizon
 * @param {number} [a.prevalence]   binary: outcome proportion
 */
export function pmsampsize(a) {
  const { type, parameters } = a;
  const shrinkage = a.shrinkage ?? 0.9;
  const hasNag = a.nagrsquared != null, hasCs = a.csrsquared != null;
  if (!Number.isInteger(parameters) || parameters < 1) throw new InputError("Parameters must be a whole number of at least 1.");
  if (!(shrinkage > 0 && shrinkage < 1)) throw new InputError("Shrinkage must be between 0 and 1.");
  if (hasNag === hasCs) throw new InputError("Give exactly one of Nagelkerke or Cox-Snell R².");
  const r2in = hasNag ? a.nagrsquared : a.csrsquared;
  if (!(r2in >= 0 && r2in <= 1)) throw new InputError("R² must be between 0 and 1.");

  if (type === "s") {
    const { rate, meanfup, timepoint } = a;
    if (!(rate > 0) || !(meanfup > 0) || !(timepoint > 0)) throw new InputError("Rate, mean follow-up and time point must all be above 0.");
    let rsquared = a.csrsquared;
    if (hasNag) {
      const events = parameters * rate * meanfup;
      const lnLnull = (events * Math.log(events / parameters)) - events;
      const maxR2a = 1 - Math.exp((2 * lnLnull) / parameters);
      rsquared = roundTo(a.nagrsquared * maxR2a, 3);
    }
    return survival({ rsquared, parameters, rate, timepoint, meanfup, shrinkage });
  }
  if (type === "b") {
    const { prevalence } = a;
    if (!(prevalence > 0 && prevalence < 1)) throw new InputError("Prevalence must be between 0 and 1.");
    let rsquared = a.csrsquared;
    if (hasNag) {
      const E = parameters * prevalence;
      const lnLnull = (E * Math.log(E / parameters)) + ((parameters - E) * Math.log(1 - (E / parameters)));
      const maxR2a = 1 - Math.exp((2 * lnLnull) / parameters);
      rsquared = roundTo(a.nagrsquared * maxR2a, 3);
    }
    return binary({ rsquared, parameters, prevalence, shrinkage });
  }
  throw new InputError('type must be "s" or "b".');
}

const nForShrinkage = (p, S, r2a) => Math.ceil(p / ((S - 1) * Math.log(1 - (r2a / S))));

function checkR2(r2a, shrinkage, maxR2a) {
  if (shrinkage < r2a) throw new InputError("The target shrinkage is lower than the Cox-Snell R². Lower the R² or raise the shrinkage.");
  if (maxR2a != null && maxR2a < r2a) throw new InputError(`A Cox-Snell R² of ${r2a} is above the maximum possible for this outcome frequency (${maxR2a.toFixed(3)}).`);
}

/** pmsampsize_surv() — mirrors pmsampsize. */
export function survival({ rsquared, parameters, rate, timepoint, meanfup, shrinkage }) {
  const r2a = rsquared;
  const n = 10000;
  const events = Math.ceil(rate * (meanfup * n));
  checkR2(r2a, shrinkage);
  const n1 = nForShrinkage(parameters, shrinkage, r2a);
  const maxR2a = maxR2cs(lnLnullSurvival(events, n), n);
  checkR2(r2a, shrinkage, maxR2a);
  const s2 = r2a / (r2a + (0.05 * maxR2a));
  const n2 = nForShrinkage(parameters, s2, r2a);
  const n3 = Math.max(n1, n2);
  const precision = riskPrecision(rate, roundTo(meanfup * n3, 1), timepoint);
  const nfinal = Math.max(n1, n2, n3);
  const ev = k => k * rate * meanfup;
  return finish({
    type: "s", r2a, maxR2a, parameters, shrinkage, s2, n1, n2, n3, nfinal, ev,
    extra: { precision, rate, meanfup, timepoint, personTime: roundTo(meanfup * nfinal, 1) },
  });
}

/** pmsampsize_bin() — mirrors pmsampsize. */
export function binary({ rsquared, parameters, prevalence, shrinkage }) {
  const r2a = rsquared;
  checkR2(r2a, shrinkage);
  const n1 = nForShrinkage(parameters, shrinkage, r2a);
  const E1 = n1 * prevalence;
  const maxR2a = maxR2cs(lnLnullBinary(E1, n1), n1);
  checkR2(r2a, shrinkage, maxR2a);
  const s2 = r2a / (r2a + (0.05 * maxR2a));
  const n2 = nForShrinkage(parameters, s2, r2a);
  const n3 = Math.ceil(((1.96 / 0.05) ** 2) * (prevalence * (1 - prevalence)));
  const nfinal = Math.max(n1, n2, n3);
  const ev = k => k * prevalence;
  return finish({ type: "b", r2a, maxR2a, parameters, shrinkage, s2, n1, n2, n3, nfinal, ev, extra: { prevalence } });
}

function finish({ type, r2a, maxR2a, parameters, shrinkage, s2, n1, n2, n3, nfinal, ev, extra }) {
  const crit = [
    { id: 1, n: n1, shrinkage },
    { id: 2, n: n2, shrinkage: s2 },
    { id: 3, n: n3, shrinkage: Math.max(shrinkage, s2) },
  ].map(c => ({ ...c, events: ev(c.n), epp: ev(c.n) / parameters }));
  const binding = nfinal === n1 ? 1 : nfinal === n2 ? 2 : 3;
  return {
    type, sampleSize: nfinal, parameters, r2cs: r2a, maxR2cs: maxR2a, nagR2: r2a / maxR2a,
    finalShrinkage: Math.max(shrinkage, s2), criteria: crit, binding,
    events: ev(nfinal), epp: ev(nfinal) / parameters, ...extra,
  };
}

/** Criterion 3 for survival: 95% CI of the cumulative incidence at the time point (exponential). */
export function riskPrecision(rate, personTime, timepoint) {
  const se = Math.sqrt(rate / personTime);
  const risk = 1 - Math.exp(-rate * timepoint);
  const upper = 1 - Math.exp(-(rate + 1.96 * se) * timepoint);
  const lower = 1 - Math.exp(-(rate - 1.96 * se) * timepoint);
  return { risk, lower, upper, margin: upper - risk };
}

// ---------------------------------------------------------------------------
// Working backwards: the largest parameter count a fixed cohort supports
// ---------------------------------------------------------------------------

/**
 * Largest p with required sample size <= n. Returns p = 0 when even one parameter
 * is not supported, with `next` holding the requirement for p + 1.
 */
export function maxParameters(n, args, cap = 2000) {
  const call = p => pmsampsize({ ...args, parameters: p });
  let p = 0, atMax = null, next = call(1);
  while (next.sampleSize <= n && p < cap) { p++; atMax = next; next = call(p + 1); }
  return { p, atMax, next };
}

// ---------------------------------------------------------------------------
// Anticipated R² from what a previous study reports (Riley et al. 2019, Part II)
// ---------------------------------------------------------------------------

/** Max Cox-Snell R² for a study with `events` outcomes among `n`. */
export const studyMaxR2cs = (outcome, events, n) =>
  maxR2cs(outcome === "s" ? lnLnullSurvival(events, n) : lnLnullBinary(events, n), n);

/** Optimism-adjust an apparent Cox-Snell R² (eqs. 6-8). p = parameters of the previous model. */
export function adjustApparent(r2csApp, n, p) {
  const LR = -n * Math.log(1 - r2csApp);
  const S = 1 - p / LR; // = 1 + p / (n ln(1 - R²app)), eq. 7
  if (!(S > 0)) throw new InputError("The previous model's likelihood ratio is not above its number of parameters, so its heuristic shrinkage is 0 or less. Its R² can't be used.");
  return { LR, S, r2csApp, r2csAdj: S * r2csApp };
}

/** From a likelihood-ratio (chi²) statistic of a previous model. */
export function fromLikelihoodRatio({ outcome, LR, df, n, events }) {
  const r2csApp = 1 - Math.exp(-LR / n); // eq. 6
  const adj = adjustApparent(r2csApp, n, df);
  return withNag(outcome, events, n, adj);
}

/** From a reported Nagelkerke or Cox-Snell R², apparent or already adjusted. */
export function fromReportedR2({ outcome, value, scale, apparent, n, events, p }) {
  const maxR2 = studyMaxR2cs(outcome, events, n);
  const r2cs = scale === "nag" ? value * maxR2 : value; // eq. 15
  if (r2cs >= maxR2) throw new InputError("That R² is above the maximum possible for the previous study's event count.");
  const adj = apparent ? adjustApparent(r2cs, n, p) : { r2csApp: null, r2csAdj: r2cs, S: null, LR: null };
  return withNag(outcome, events, n, adj);
}

/** From Harrell's C of a previous survival model (eqs. 17-22: C -> D -> R²_D -> R²_OQ -> LR). */
export function fromHarrellC({ C, n, events, p }) {
  if (!(C > 0.5 && C < 1)) throw new InputError("C must be between 0.5 and 1.");
  const x = C - 0.5;
  const D = 5.50 * x + 10.26 * x ** 3; // Jinks et al. 2015
  const k2 = Math.PI / 8, s2 = Math.PI ** 2 / 6; // D²/kappa² with kappa² = 8/pi; sigma² = pi²/6
  const R2D = (k2 * D * D) / (s2 + k2 * D * D);
  const R2OQ = (s2 * R2D) / (1 - R2D + s2 * R2D);
  const LR = -events * Math.log(1 - R2OQ); // eq. 18
  const r2csApp = 1 - Math.exp(-LR / n); // eq. 6
  const adj = adjustApparent(r2csApp, n, p);
  return { D, R2D, R2OQ, ...withNag("s", events, n, adj) };
}

function withNag(outcome, events, n, adj) {
  const maxR2 = studyMaxR2cs(outcome, events, n);
  return { ...adj, maxR2, nag: adj.r2csAdj / maxR2 };
}

/**
 * Cox-Snell R² implied by a C statistic (AUROC) at a given prevalence.
 * pmsampsize's cstat2rsq() simulates 1e6 people from a binormal model and fits a logistic
 * regression. Logistic regression is the true model there, so the large-sample limit of its
 * LR/n is 2 × the mutual information between outcome and linear predictor. We compute that
 * integral directly; the result agrees with the simulation to about ±0.0005.
 */
export function cstatToR2Binary(C, prevalence) {
  if (!(C > 0.5 && C < 1)) throw new InputError("C must be between 0.5 and 1.");
  if (!(prevalence > 0 && prevalence < 1)) throw new InputError("Prevalence must be between 0 and 1.");
  const mu = Math.SQRT2 * qnorm(C);
  const w0 = prevalence, w1 = 1 - prevalence;
  const phi = z => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const lo = Math.min(0, mu) - 9, hi = Math.max(0, mu) + 9, steps = 6000, h = (hi - lo) / steps;
  let I = 0;
  for (let i = 0; i <= steps; i++) {
    const x = lo + i * h;
    const f0 = phi(x), f1 = phi(x - mu), f = w0 * f0 + w1 * f1;
    let g = 0;
    if (f0 > 0) g += w0 * f0 * Math.log(f0 / f);
    if (f1 > 0) g += w1 * f1 * Math.log(f1 / f);
    I += g * (i === 0 || i === steps ? 1 : i % 2 ? 4 : 2);
  }
  I *= h / 3;
  return 1 - Math.exp(-2 * I);
}

/** Inverse standard normal CDF (Acklam's algorithm, relative error < 1.2e-9). */
export function qnorm(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -qnorm(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ---------------------------------------------------------------------------
// Counting candidate parameters
// ---------------------------------------------------------------------------

/** Degrees of freedom a candidate predictor uses. */
export function predictorDf(kind, k) {
  switch (kind) {
    case "binary": return 1;
    case "linear": return 1;
    case "spline": return Math.max(1, (k | 0) - 1); // restricted cubic spline, k knots
    case "fp2": return 4; // FP2: two powers + two coefficients (Royston & Sauerbrei)
    case "fp1": return 2;
    case "categorical": return Math.max(1, (k | 0) - 1); // k levels
    case "custom": return Math.max(0, k | 0);
    default: throw new InputError(`Unknown predictor kind ${kind}`);
  }
}
