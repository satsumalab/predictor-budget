import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as P from "../assets/pms.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"));
const r2arg = r => (r.nag != null ? { nagrsquared: r.nag } : { csrsquared: r.cs });

test(`survival matches pmsampsize ${fx.version} on ${fx.survival.length} cases`, () => {
  for (const r of fx.survival) {
    const args = { type: "s", ...r2arg(r), parameters: r.p, shrinkage: r.shrink, rate: r.rate, timepoint: 2, meanfup: r.meanfup };
    if (r.error) { assert.throws(() => P.pmsampsize(args), P.InputError, JSON.stringify(r)); continue; }
    const o = P.pmsampsize(args);
    const got = { n: o.sampleSize, n1: o.criteria[0].n, n2: o.criteria[1].n, n3: o.criteria[2].n, upper: P.roundTo(o.precision.upper, 3) };
    assert.deepEqual(got, { n: r.n, n1: r.n1, n2: r.n2, n3: r.n3, upper: r.upper }, JSON.stringify(r));
  }
});

test(`binary matches pmsampsize ${fx.version} on ${fx.binary.length} cases`, () => {
  for (const r of fx.binary) {
    const args = { type: "b", ...r2arg(r), parameters: r.p, shrinkage: r.shrink, prevalence: r.prev };
    if (r.error) { assert.throws(() => P.pmsampsize(args), P.InputError, JSON.stringify(r)); continue; }
    const o = P.pmsampsize(args);
    const got = { n: o.sampleSize, n1: o.criteria[0].n, n2: o.criteria[1].n, n3: o.criteria[2].n };
    assert.deepEqual(got, { n: r.n, n1: r.n1, n2: r.n2, n3: r.n3 }, JSON.stringify(r));
  }
});

test("C statistic -> Cox-Snell R² is within 0.001 of pmsampsize's simulation", () => {
  for (const r of fx.cstat) {
    const got = P.cstatToR2Binary(r.C, r.prev);
    assert.ok(Math.abs(got - r.r2) < 0.001, `C=${r.C} prev=${r.prev}: ${got} vs R ${r.r2}`);
  }
});

test("Riley 2019 Part II, survival example: Harrell's C 0.69 chain", () => {
  // E = 161, n = 1200, 6 parameters; paper: D 1.115, R²_D 0.229, R²_OQ 0.328, LR 64.05, R²CS,app 0.052
  const o = P.fromHarrellC({ C: 0.69, n: 1200, events: 161, p: 6 });
  assert.equal(o.D.toFixed(3), "1.115");
  assert.equal(o.R2D.toFixed(3), "0.229");
  assert.equal(o.R2OQ.toFixed(3), "0.328");
  assert.ok(Math.abs(o.LR - 64.05) < 0.1, `LR ${o.LR}`);
  assert.equal(o.r2csApp.toFixed(3), "0.052");
  assert.equal((1 - 6 / 64.05).toFixed(3), o.S.toFixed(3));
});

test("Riley 2019 Part II, survival example: R²CS 0.051, 25 parameters -> 4286", () => {
  const o = P.pmsampsize({ type: "s", csrsquared: 0.051, parameters: 25, rate: 0.065, timepoint: 2, meanfup: 2.07 });
  assert.equal(o.sampleSize, 4286);
});

test("Riley 2019 Part II, binary example: R²CS 0.288, 24 parameters, prevalence 0.174", () => {
  // The paper prints 623 / 668 / 221. pmsampsize 1.1.3 gives 623 / 662 / 221 (checked in R); we follow the package.
  const o = P.pmsampsize({ type: "b", csrsquared: 0.288, parameters: 24, prevalence: 0.174 });
  assert.deepEqual(o.criteria.map(c => c.n), [623, 662, 221]);
  assert.equal(o.sampleSize, 662);
});

test("adjusted R² from a likelihood ratio uses S × R²app (eq. 8)", () => {
  const o = P.fromLikelihoodRatio({ outcome: "s", LR: 30, df: 5, n: 400, events: 40 });
  const app = 1 - Math.exp(-30 / 400);
  assert.ok(Math.abs(o.r2csAdj - (1 - 5 / 30) * app) < 1e-12);
  assert.ok(Math.abs(o.nag - o.r2csAdj / o.maxR2) < 1e-12);
});

test("maxParameters returns 0 when even one parameter is unsupported", () => {
  const r = P.maxParameters(50, { type: "s", nagrsquared: 0.1, rate: 0.02, timepoint: 5, meanfup: 5 });
  assert.equal(r.p, 0);
  assert.ok(r.next.sampleSize > 50);
});

test("maxParameters: binary cohort below criterion 3 supports nothing", () => {
  const r = P.maxParameters(150, { type: "b", nagrsquared: 0.5, prevalence: 0.3 });
  assert.equal(r.p, 0);
  assert.equal(r.next.binding, 3);
});

test("maxParameters is the boundary", () => {
  const args = { type: "s", nagrsquared: 0.12, rate: 0.02, timepoint: 5, meanfup: 5 };
  const r = P.maxParameters(600, args);
  assert.ok(r.atMax.sampleSize <= 600 && r.next.sampleSize > 600);
  assert.equal(r.next.parameters, r.p + 1);
});

test("parameter counting", () => {
  assert.equal(P.predictorDf("categorical", 4), 3);
  assert.equal(P.predictorDf("spline", 4), 3);
  assert.equal(P.predictorDf("fp2"), 4);
  assert.equal(P.predictorDf("binary"), 1);
});

test("qnorm", () => {
  assert.ok(Math.abs(P.qnorm(0.975) - 1.959963984540054) < 1e-8);
  assert.ok(Math.abs(P.qnorm(0.01) + 2.326347874040841) < 1e-8);
});

test("binary C statistic: closed form equals the mean of pmsampsize's simulation over seeds", () => {
  for (const r of fx.cstat_seeds) {
    const got = P.cstatToR2Binary(r.C, r.prev);
    assert.ok(Math.abs(got - r.mean) < 0.0002, `C=${r.C} prev=${r.prev}: ${got} vs seed mean ${r.mean} (sd ${r.sd})`);
  }
});

test("binary C statistic: sample sizes within 2% of pmsampsize's cstatistic= route (its default seed)", () => {
  // pmsampsize's default seed (123456) gives an R² about 1.5 Monte Carlo SDs low at these settings,
  // so R's sample sizes run up to ~2% higher than the large-sample value used here.
  for (const r of fx.cstat_budget) {
    const cs = P.roundTo(P.cstatToR2Binary(r.C, r.prev), 4);
    const n = P.pmsampsize({ type: "b", csrsquared: cs, parameters: r.p, prevalence: r.prev }).sampleSize;
    assert.ok(Math.abs(n - r.n) / r.n <= 0.02, `C=${r.C} prev=${r.prev} p=${r.p}: ${n} vs R ${r.n}`);
  }
});

test("reported apparent R² gives the same answer as the equivalent likelihood ratio", () => {
  for (const [outcome, n, events, p] of [["s", 400, 38, 5], ["b", 600, 120, 8]]) {
    const maxR2 = P.studyMaxR2cs(outcome, events, n);
    const nag = 0.2, app = nag * maxR2, LR = -n * Math.log(1 - app);
    const a = P.fromReportedR2({ outcome, value: nag, scale: "nag", apparent: true, n, events, p });
    const b = P.fromLikelihoodRatio({ outcome, LR, df: p, n, events });
    assert.ok(Math.abs(a.r2csAdj - b.r2csAdj) < 1e-12 && Math.abs(a.S - b.S) < 1e-12);
    const c = P.fromReportedR2({ outcome, value: app, scale: "cs", apparent: true, n, events, p });
    assert.ok(Math.abs(c.r2csAdj - b.r2csAdj) < 1e-12);
  }
});

test("reported optimism-corrected R² is used as given", () => {
  const o = P.fromReportedR2({ outcome: "s", value: 0.05, scale: "cs", apparent: false, n: 400, events: 38 });
  assert.equal(o.r2csAdj, 0.05);
  assert.equal(o.S, null);
  assert.throws(() => P.fromReportedR2({ outcome: "s", value: 0.99, scale: "cs", apparent: false, n: 400, events: 38 }), P.InputError);
});

test("survival max R²: pmsampsize's events/n form, not the paper's person-time form", () => {
  // Riley 2019 VTE example (E = 161, n = 1200, T = 2483): the paper prints 0.37; pmsampsize gives 0.555.
  const o = P.pmsampsize({ type: "s", csrsquared: 0.051, parameters: 25, rate: 0.065, timepoint: 2, meanfup: 2.07 });
  assert.equal(o.maxR2cs.toFixed(3), "0.555");
});
