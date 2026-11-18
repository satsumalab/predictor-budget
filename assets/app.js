import * as P from "./pms.js";

const $ = id => document.getElementById(id);
const SERIES = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6"];
const FIELDS = ["n", "events", "py", "tp", "nagDefault", "lrStat", "repValue", "repScale", "repApparent", "cValue",
  "srcN", "srcEvents", "srcP", "sens", "extra", "scale", "shrink", "plannedOverride"];
const RADIOS = ["outcome", "source"];
const KINDS = [
  ["binary", "Yes/no"], ["linear", "Linear"], ["spline", "Spline"],
  ["fp1", "FP1"], ["fp2", "FP2"], ["categorical", "Categorical"], ["custom", "Other df"],
];
const NEEDS_K = { spline: "knots", categorical: "levels", custom: "df" };

const EXAMPLE = Object.freeze({
  outcome: "s", n: 500, events: 60, py: 2600, tp: 5,
  source: "none", nagDefault: 0.15, lrStat: 26.4, repValue: 0.2, repScale: "nag", repApparent: "app", cValue: 0.72,
  srcN: 400, srcEvents: 38, srcP: 5,
  sens: true, extra: "", scale: "nag", shrink: 0.9, plannedOverride: "",
  predictors: [
    { name: "Age", kind: "spline", k: 3 }, { name: "Sex", kind: "binary" }, { name: "Stage", kind: "categorical", k: 4 },
    { name: "Performance status", kind: "categorical", k: 3 }, { name: "BMI", kind: "linear" },
  ],
});

let state = loadFromHash() || structuredClone(EXAMPLE);
let selected = null; // R² value of the selected table row

// ---------------------------------------------------------------- form <-> state
function writeForm() {
  for (const k of FIELDS) { const el = $(k); if (el.type === "checkbox") el.checked = !!state[k]; else el.value = state[k] ?? ""; }
  for (const k of RADIOS) for (const el of document.getElementsByName(k)) el.checked = el.value === state[k];
  renderPredictors();
}
function readForm() {
  for (const k of FIELDS) { const el = $(k); state[k] = el.type === "checkbox" ? el.checked : el.value; }
  for (const k of RADIOS) { const el = document.querySelector(`input[name="${k}"]:checked`); if (el) state[k] = el.value; }
}
const num = x => (x === "" || x == null ? NaN : Number(x));
const isPosInt = x => Number.isInteger(x) && x > 0;

// ---------------------------------------------------------------- predictors editor
function renderPredictors() {
  $("predList").innerHTML = state.predictors.map((p, i) => `
    <div class="pred" data-i="${i}">
      <input type="text" id="pname-${i}" aria-label="Predictor ${i + 1} name" value="${esc(p.name || "")}" placeholder="Name">
      <select id="pkind-${i}" aria-label="Predictor ${i + 1} form">${KINDS.map(([v, t]) => `<option value="${v}"${v === p.kind ? " selected" : ""}>${t}</option>`).join("")}</select>
      <input type="number" id="pk-${i}" aria-label="Predictor ${i + 1} ${NEEDS_K[p.kind] || "levels"}" min="1" step="1" value="${p.k ?? ""}" ${NEEDS_K[p.kind] ? "" : "hidden"} placeholder="${NEEDS_K[p.kind] || ""}">
      ${NEEDS_K[p.kind] ? "" : "<span></span>"}
      <span class="df" id="pdf-${i}"></span>
      <button type="button" class="icon" data-remove="${i}" aria-label="Remove ${esc(p.name || "predictor")}">×</button>
    </div>`).join("");
  updatePredictorDfs();
}
function predDf(p) {
  if (NEEDS_K[p.kind] && !(Number(p.k) >= (p.kind === "custom" ? 0 : 2))) return NaN;
  return P.predictorDf(p.kind, Number(p.k));
}
function updatePredictorDfs() {
  let total = 0, ok = true;
  state.predictors.forEach((p, i) => {
    const df = predDf(p);
    $(`pdf-${i}`).textContent = Number.isFinite(df) ? df : "?";
    $(`pk-${i}`)?.classList.toggle("invalid", !Number.isFinite(df));
    if (Number.isFinite(df)) total += df; else ok = false;
  });
  $("predTotal").textContent = ok ? total : `${total} + ?`;
  return ok ? total : NaN;
}
$("predList").addEventListener("input", e => {
  const row = e.target.closest(".pred"); if (!row) return;
  const i = Number(row.dataset.i), p = state.predictors[i];
  if (e.target.id.startsWith("pname")) p.name = e.target.value;
  if (e.target.id.startsWith("pk-")) p.k = e.target.value;
  if (e.target.id.startsWith("pkind")) {
    p.kind = e.target.value;
    p.k = p.kind === "spline" ? 3 : p.kind === "categorical" ? 3 : p.kind === "custom" ? 1 : undefined;
    renderPredictors(); $(`pkind-${i}`).focus();
  }
  render();
});
$("predList").addEventListener("click", e => {
  const b = e.target.closest("[data-remove]"); if (!b) return;
  state.predictors.splice(Number(b.dataset.remove), 1);
  renderPredictors(); render();
});
$("addPred").addEventListener("click", () => {
  state.predictors.push({ name: "", kind: "binary" });
  renderPredictors(); render();
  $(`pname-${state.predictors.length - 1}`).focus();
});

// ---------------------------------------------------------------- the calculation
function compute(s) {
  const errs = [], bad = new Set();
  const need = (ok, keys, msg) => { if (!ok) { errs.push(msg); [].concat(keys).forEach(k => bad.add(k)); } return ok; };
  const outcome = s.outcome;
  const n = num(s.n), events = num(s.events), py = num(s.py), tp = num(s.tp), shrink = num(s.shrink);

  let cohortOk = need(isPosInt(n), "n", "Patients must be a whole number above 0.")
    & need(isPosInt(events), "events", "Events must be a whole number above 0.");
  cohortOk = cohortOk && need(events < n, "events", "Events must be fewer than patients.");
  if (outcome === "s") {
    cohortOk = need(py > 0, "py", "Total follow-up must be above 0.") && cohortOk;
    cohortOk = need(tp > 0, "tp", "Prediction horizon must be above 0.") && cohortOk;
  }
  const shrinkOk = need(shrink > 0 && shrink < 1, "shrink", "Target shrinkage must be between 0 and 1.");
  const cohort = cohortOk ? {
    n, events, py, tp,
    rate: events / py, meanfup: py / n, prevalence: events / n,
    maxR2: P.studyMaxR2cs(outcome, events, n),
  } : null;

  // anticipated R² from the chosen source
  let base = null, chain = null;
  const srcN = num(s.srcN), srcE = num(s.srcEvents), srcP = num(s.srcP);
  const srcOk = (withP) => need(isPosInt(srcN), "srcN", "Previous model: patients must be a whole number.")
    & need(isPosInt(srcE) && srcE < srcN, "srcEvents", "Previous model: events must be a whole number below its patients.")
    & (!withP || need(isPosInt(srcP), "srcP", "Previous model: parameters must be a whole number."));
  try {
    if (s.source === "none") {
      const v = num(s.nagDefault);
      if (need(v > 0 && v < 1, "nagDefault", "Nagelkerke R² must be between 0 and 1.")) base = { nag: v, cs: cohort ? v * cohort.maxR2 : null };
    } else if (s.source === "lr") {
      const LR = num(s.lrStat);
      if (need(LR > 0, "lrStat", "Enter the likelihood-ratio χ².") & srcOk(true)) {
        chain = P.fromLikelihoodRatio({ outcome, LR, df: srcP, n: srcN, events: srcE });
        base = { nag: chain.nag, cs: chain.r2csAdj };
      }
    } else if (s.source === "reported") {
      const v = num(s.repValue), apparent = s.repApparent === "app";
      if (need(v > 0 && v < 1, "repValue", "R² must be between 0 and 1.") & srcOk(apparent)) {
        chain = P.fromReportedR2({ outcome, value: v, scale: s.repScale, apparent, n: srcN, events: srcE, p: srcP });
        base = { nag: chain.nag, cs: chain.r2csAdj };
      }
    } else if (s.source === "cstat") {
      const C = num(s.cValue);
      if (need(C > 0.5 && C < 1, "cValue", "C statistic must be between 0.5 and 1.")) {
        if (outcome === "s") {
          if (srcOk(true)) { chain = P.fromHarrellC({ C, n: srcN, events: srcE, p: srcP }); base = { nag: chain.nag, cs: chain.r2csAdj }; }
        } else if (cohort) {
          const cs = P.roundTo(P.cstatToR2Binary(C, cohort.prevalence), 4);
          chain = { r2csAdj: cs, approx: true };
          base = { cs, nag: cs / cohort.maxR2 };
        }
      }
    }
  } catch (e) { errs.push(e.message); bad.add(s.source === "lr" ? "lrStat" : s.source === "cstat" ? "cValue" : "repValue"); }

  // the R² values to evaluate
  const scale = s.scale === "cs" ? "cs" : "nag";
  const rnd = v => P.roundTo(v, scale === "nag" ? 3 : 4);
  let r2s = [];
  if (base && base[scale] != null) {
    const b = rnd(base[scale]);
    r2s.push({ v: b, role: "base" });
    if (s.sens) r2s.push({ v: rnd(b * 0.8), role: "−20%" }, { v: rnd(b * 1.2), role: "+20%" });
  }
  const extras = String(s.extra || "").split(/[,;\s]+/).filter(Boolean).map(Number);
  need(extras.every(x => x > 0 && x < 1), "extra", "Other R² values must be numbers between 0 and 1.");
  extras.filter(x => x > 0 && x < 1).forEach(x => r2s.push({ v: rnd(x), role: "" }));
  const seen = new Set();
  r2s = r2s.filter(r => r.v > 0 && !seen.has(r.v) && seen.add(r.v)).sort((a, b) => a.v - b.v);
  if (r2s.length > 6) { errs.push("Showing the first 6 R² values only."); r2s = r2s.slice(0, 6); }

  const argsFor = v => ({
    type: outcome, [scale === "nag" ? "nagrsquared" : "csrsquared"]: v, shrinkage: shrink,
    ...(outcome === "s" ? { rate: cohort?.rate, meanfup: cohort?.meanfup, timepoint: tp } : { prevalence: cohort?.prevalence }),
  });
  const rows = cohort && shrinkOk ? r2s.map((r, i) => {
    try { return { ...r, i, ...P.maxParameters(n, argsFor(r.v)) }; }
    catch (e) { return { ...r, i, error: e.message }; }
  }) : [];

  // planned parameters
  const override = num(s.plannedOverride);
  let planned = null;
  if (s.plannedOverride !== "" && s.plannedOverride != null) {
    if (need(isPosInt(override), "plannedOverride", "The total number of parameters must be a whole number.")) planned = override;
  } else {
    const t = updatePredictorDfs();
    if (state.predictors.length && Number.isFinite(t) && t > 0) planned = t;
  }
  return { outcome, cohort, base, chain, scale, rows, planned, errs, bad, argsFor, shrink };
}

// ---------------------------------------------------------------- rendering
const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "–");
const pct = x => (x * 100).toFixed(1) + "%";
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plural = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
const critName = { 1: "Criterion 1 · overfitting", 2: "Criterion 2 · R² optimism", 3: "Criterion 3 · overall risk" };

function render() {
  readForm();
  const s = state, out = compute(s), isS = s.outcome === "s";
  writeHash();

  // visibility and labels
  document.querySelectorAll("[data-outcome]").forEach(el => (el.hidden = el.dataset.outcome !== s.outcome));
  document.querySelectorAll("[data-source]").forEach(el => (el.hidden = el.dataset.source !== s.source));
  const showSrc = s.source === "lr" || s.source === "reported" || (s.source === "cstat" && isS);
  $("srcStudy").hidden = !showSrc;
  $("srcPField").hidden = s.source === "reported" && s.repApparent !== "app";
  $("srcPLabel").textContent = s.source === "lr" ? "df of the test" : "Parameters";
  $("eventsLabel").textContent = isS ? "Outcome events" : "Patients with the outcome";
  $("cstatDesc").textContent = isS ? "Harrell's C-index of a similar model." : "AUC (ROC area) of a similar model.";
  $("cLabel").textContent = isS ? "Harrell's C" : "C statistic (AUC)";
  $("exampleBanner").hidden = !isExample();
  for (const k of FIELDS) $(k).classList.toggle("invalid", out.bad.has(k));
  $("howto").textContent = isS
    ? `# d: one row per patient; time in days, status 1 = event\nn        <- nrow(d)\nevents   <- sum(d$status == 1)\ntotal_py <- sum(d$time) / 365.25`
    : `# d: one row per patient; y 1 = outcome, 0 = none\nd      <- d[!is.na(d$y), ]\nn      <- nrow(d)\nevents <- sum(d$y == 1)`;

  renderBase(out);
  $("errors").innerHTML = out.errs.map(e => `<div class="msg bad">${esc(e)}</div>`).join("");

  const rows = out.rows;
  const baseRow = rows.find(r => r.role === "base");
  if (selected == null || !rows.some(r => r.v === selected)) selected = baseRow ? baseRow.v : rows[0]?.v ?? null;

  renderVerdict(out, baseRow);
  renderFacts(out);
  renderTable(out);
  renderChart(out);
  renderDetail(out, rows.find(r => r.v === selected));
  renderR(out);
}

function renderBase(out) {
  const c = out.chain, s = state, b = out.base;
  if (!b) { $("baseOut").innerHTML = "Waiting for valid inputs."; return; }
  const lines = [];
  if (s.source === "cstat" && out.outcome === "s")
    lines.push(`D = ${fmt(c.D)} · R²<sub>D</sub> = ${fmt(c.R2D)} · R²<sub>OQ</sub> = ${fmt(c.R2OQ)} · LR = ${fmt(c.LR, 1)}`);
  if (c && c.S != null) lines.push(`R²<sub>CS,app</sub> = ${fmt(c.r2csApp, 4)} · shrinkage S = ${fmt(c.S)}`);
  if (c && c.approx) lines.push(`Cox-Snell R² at your outcome rate ≈ <b>${fmt(c.r2csAdj, 4)}</b>`);
  else if (c) lines.push(`R²<sub>CS,adj</sub> = <b>${fmt(c.r2csAdj, 4)}</b> · Nagelkerke = <b>${fmt(c.nag, 3)}</b>`);
  else lines.push(`Nagelkerke = <b>${fmt(b.nag, 3)}</b>${b.cs != null ? ` · Cox-Snell in your cohort = ${fmt(b.cs, 4)}` : ""}`);
  lines.push(`Base case used: <b>${out.scale === "nag" ? "Nagelkerke" : "Cox-Snell"} ${fmt(P.roundTo(b[out.scale] ?? NaN, out.scale === "nag" ? 3 : 4), out.scale === "nag" ? 3 : 4)}</b>`);
  $("baseOut").innerHTML = lines.join("<br>");
}

function renderVerdict(out, baseRow) {
  const K = out.planned, head = $("verdictHead"), pills = [], text = [];
  $("advice").hidden = false;
  if (!out.cohort || !baseRow) {
    head.textContent = "Fill in the steps on the left";
    $("verdictPills").innerHTML = ""; $("verdictText").textContent = "";
    return;
  }
  if (baseRow.error) { head.textContent = "This R² can't be used"; $("verdictPills").innerHTML = `<span class="pill bad">${esc(baseRow.error)}</span>`; $("verdictText").textContent = ""; return; }
  const P0 = baseRow.p;
  const ok = out.rows.filter(r => !r.error);
  const lo = Math.min(...ok.map(r => r.p)), hi = Math.max(...ok.map(r => r.p));
  if (P0 === 0) {
    head.innerHTML = `Your cohort can't support <em>even one</em> candidate parameter`;
    text.push(baseRow.next.binding === 3
      ? `A binary model needs at least ${baseRow.next.criteria[2].n} patients just to estimate the overall outcome risk to within ±0.05. You have ${out.cohort.n}.`
      : `One parameter would need ${baseRow.next.sampleSize} patients at this R². You have ${out.cohort.n}.`);
    pills.push(`<span class="pill bad">Cohort too small</span>`);
  } else {
    head.innerHTML = `Your cohort supports up to <em>${plural(P0, "candidate parameter")}</em>`;
    text.push(`At the base-case R², ${plural(P0, "parameter")} need ${baseRow.atMax.sampleSize} patients and you have ${out.cohort.n}.` +
      (lo !== hi ? ` Across the R² values tried the budget ranges from ${lo} to ${hi}.` : ""));
  }
  if (K != null) {
    let atK = null; try { atK = P.pmsampsize({ ...out.argsFor(baseRow.v), parameters: K }); } catch { }
    if (K <= P0) pills.push(`<span class="pill good">Your ${plural(K, "parameter")}: within budget</span>`);
    else if (K <= hi) pills.push(`<span class="pill warn">Your ${plural(K, "parameter")}: only if the model does better than the base case</span>`);
    else pills.push(`<span class="pill bad">Your ${plural(K, "parameter")}: over budget by ${K - P0}</span>`);
    if (atK) text.push(`Your ${K} would need ${atK.sampleSize} patients (${fmt(atK.events, 0)} events) at the base-case R².`);
    $("advice").hidden = K <= P0;
  } else {
    text.push("Add your candidate predictors in step 4 to check them against this budget.");
  }
  $("verdictPills").innerHTML = pills.join("");
  $("verdictText").textContent = text.join(" ");
}

function renderFacts(out) {
  const c = out.cohort;
  if (!c) { $("facts").innerHTML = ""; return; }
  const f = out.outcome === "s"
    ? [["Event rate", fmt(c.rate, 4) + " per year"], ["Mean follow-up", fmt(c.meanfup, 2) + " years"], ["Events per patient", fmt(c.prevalence, 3)], ["Max Cox-Snell R²", fmt(c.maxR2, 3)]]
    : [["Outcome prevalence", pct(c.prevalence)], ["Max Cox-Snell R²", fmt(c.maxR2, 3)], ["Minimum n for overall risk", String(Math.ceil((1.96 / 0.05) ** 2 * c.prevalence * (1 - c.prevalence)))]];
  $("facts").innerHTML = f.map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join("");
}

function rowLabel(r) {
  const tag = r.role === "base" ? `<span class="tag base">base case</span>` : r.role ? `<span class="tag">${r.role}</span>` : "";
  return `<span class="swatch" style="background:var(${SERIES[r.i]})"></span>${fmt(r.v, state.scale === "cs" ? 4 : 3)}${tag}`;
}
function renderTable(out) {
  $("rows").innerHTML = out.rows.map(r => {
    const sel = r.v === selected;
    const attrs = `data-v="${r.v}" class="${sel ? "sel" : ""}" tabindex="0" aria-selected="${sel}"`;
    if (r.error) return `<tr ${attrs}><td>${rowLabel(r)}</td><td colspan="6" class="txt" style="text-align:left;white-space:normal"><span class="pill bad">${esc(r.error)}</span></td></tr>`;
    const lim = r.atMax ? r.atMax.binding : r.next.binding;
    return `<tr ${attrs}><td>${rowLabel(r)}</td><td>${fmt(r.next.r2cs, 4)}</td>
      <td class="big">${r.p === 0 ? '<span class="pill bad">0</span>' : r.p}</td>
      <td>${r.atMax ? r.atMax.sampleSize : "–"}</td><td>${r.next.sampleSize}</td>
      <td>${r.atMax ? fmt(r.atMax.epp, 1) : "–"}</td><td class="txt">Criterion ${lim}</td></tr>`;
  }).join("");
}
const pickRow = tr => { if (tr?.dataset.v) { selected = Number(tr.dataset.v); render(); } };
$("rows").addEventListener("click", e => pickRow(e.target.closest("tr")));
$("rows").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickRow(e.target.closest("tr")); } });

function renderDetail(out, r) {
  const c = out.cohort, cards = [];
  if (!c || !r || r.error) { $("cards").innerHTML = ""; $("detail").innerHTML = ""; $("detailSub").textContent = ""; return; }
  const K = out.planned;
  let d = r.atMax || r.next, label = `at the budget of ${plural(d.parameters, "parameter")}`;
  if (K != null) { try { d = P.pmsampsize({ ...out.argsFor(r.v), parameters: K }); label = `at your ${plural(K, "parameter")}`; } catch { } }
  const ok = d.sampleSize <= c.n;
  $("detailSub").textContent = `pmsampsize output ${label}, R² ${fmt(r.v, out.scale === "cs" ? 4 : 3)}`;
  cards.push(`<div class="card" style="border-color:var(${SERIES[r.i]})"><span class="k">Patients needed ${label}</span>
    <span class="v">${d.sampleSize}</span><span class="s">${fmt(d.events, 1)} events, ${fmt(d.epp, 1)} per parameter. You have ${c.n} patients and ${c.events} events.</span>
    <span class="pill ${ok ? "good" : "bad"}">${ok ? "Enough" : `Short by ${d.sampleSize - c.n}`}</span></div>`);
  if (out.outcome === "s") {
    const pr = P.riskPrecision(c.rate, c.py, c.tp), good = pr.margin <= 0.05;
    cards.push(`<div class="card"><span class="k">Overall ${c.tp}-year risk in your cohort</span><span class="v">${pct(pr.risk)}</span>
      <span class="s">95% CI ${pct(pr.lower)} to ${pct(pr.upper)} from ${c.py} person-years. Margin ${fmt(pr.margin)} against the 0.05 target.</span>
      <span class="pill ${good ? "good" : "warn"}">${good ? "Precise enough" : "Less precise than ±0.05"}</span></div>`);
  } else {
    const n3 = d.criteria[2].n, good = c.n >= n3;
    cards.push(`<div class="card"><span class="k">Patients needed to estimate overall risk</span><span class="v">${n3}</span>
      <span class="s">For a ±0.05 margin on a prevalence of ${pct(c.prevalence)}. This applies whatever the number of predictors.</span>
      <span class="pill ${good ? "good" : "bad"}">${good ? "Met" : "Not met"}</span></div>`);
  }
  $("cards").innerHTML = cards.join("");
  const crit3Name = out.outcome === "s" ? "3 · Overall risk precision (reported only)" : "3 · Overall risk within ±0.05";
  const names = ["1 · Shrinkage at least " + fmt(out.shrink, 2), "2 · Apparent vs adjusted R² within 0.05", crit3Name];
  $("detail").innerHTML = d.criteria.map((cr, i) => `<tr${cr.id === d.binding ? ' style="font-weight:600"' : ""}><td class="txt">${names[i]}</td><td>${cr.n}</td><td>${fmt(cr.shrinkage)}</td><td>${fmt(cr.events, 1)}</td><td>${fmt(cr.epp, 2)}</td></tr>`).join("")
    + `<tr style="font-weight:600"><td class="txt">Required (largest of the three)</td><td>${d.sampleSize}</td><td>${fmt(d.finalShrinkage)}</td><td>${fmt(d.events, 1)}</td><td>${fmt(d.epp, 2)}</td></tr>`;
}

function renderChart(out) {
  const box = $("chart"), ok = out.rows.filter(r => !r.error), c = out.cohort;
  if (!c || !ok.length) { box.innerHTML = ""; $("legend").innerHTML = ""; return; }
  const W = 680, H = 290, m = { l: 54, r: 16, t: 16, b: 36 };
  const maxP = Math.max(...ok.map(r => r.p), out.planned ?? 0);
  const xMax = Math.min(80, Math.max(6, Math.ceil((maxP + 1) * 1.6)));
  const series = ok.map(r => {
    const pts = [];
    for (let p = 1; p <= xMax; p++) { let v = NaN; try { v = P.pmsampsize({ ...out.argsFor(r.v), parameters: p }).sampleSize; } catch { } pts.push([p, v]); }
    return { r, pts };
  });
  const yTop = Math.max(c.n * 1.6, Math.min(...series.map(s => s.pts.at(-1)[1]).filter(Number.isFinite)));
  const raw = yTop / 5, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const yStep = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, yMax = Math.ceil(yTop / yStep) * yStep;
  const X = p => m.l + (p - 1) / (xMax - 1) * (W - m.l - m.r);
  const Y = y => m.t + (1 - Math.min(y, yMax) / yMax) * (H - m.t - m.b);
  const xStep = xMax <= 12 ? 1 : xMax <= 30 ? 5 : 10;
  let g = `<defs><clipPath id="plot"><rect x="${m.l}" y="${m.t - 3}" width="${W - m.l - m.r}" height="${H - m.t - m.b + 6}"/></clipPath></defs>`;
  for (let y = 0; y <= yMax + 1e-9; y += yStep) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(y)}" y2="${Y(y)}" stroke="var(--line-soft)"/><text x="${m.l - 8}" y="${Y(y) + 4}" text-anchor="end">${Math.round(y)}</text>`;
  for (let p = 1; p <= xMax; p++) if (p === 1 || p % xStep === 0) g += `<text x="${X(p)}" y="${H - m.b + 18}" text-anchor="middle">${p}</text>`;
  g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line)"/>`;
  g += `<text x="${(m.l + W - m.r) / 2}" y="${H - 2}" text-anchor="middle" class="lbl">candidate parameters</text>`;
  if (out.planned && out.planned <= xMax) {
    g += `<line x1="${X(out.planned)}" x2="${X(out.planned)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink-3)" stroke-dasharray="2 3"/>`;
    g += `<text x="${X(out.planned) + 5}" y="${m.t + 10}" class="lbl">your ${out.planned}</text>`;
  }
  g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(c.n)}" y2="${Y(c.n)}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="6 4"/>`;
  g += `<text x="${W - m.r}" y="${Y(c.n) - 7}" text-anchor="end" class="lbl" style="fill:var(--ink)">your cohort, n = ${c.n}</text>`;
  for (const s of series) {
    const col = `var(${SERIES[s.r.i]})`;
    const d = s.pts.filter(q => Number.isFinite(q[1])).map((q, j) => `${j ? "L" : "M"}${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join("");
    g += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" clip-path="url(#plot)"/>`;
    if (s.r.p >= 1 && s.r.p <= xMax) g += `<circle cx="${X(s.r.p)}" cy="${Y(s.r.atMax.sampleSize)}" r="4.5" fill="${col}" stroke="var(--panel)" stroke-width="2"/>`;
  }
  g += `<line id="xh" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink-3)" visibility="hidden"/>`;
  g += `<rect id="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/>`;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Patients needed against number of candidate parameters, one line per R² value; dashed line is your cohort size">${g}</svg><div class="tip" id="tip" hidden></div>`;
  $("legend").innerHTML = series.map(s => `<span><span class="swatch" style="background:var(${SERIES[s.r.i]})"></span>R² ${fmt(s.r.v, out.scale === "cs" ? 4 : 3)}${s.r.role === "base" ? " (base)" : ""}: up to ${s.r.p}</span>`).join("");

  const svg = box.querySelector("svg"), tip = $("tip"), xh = $("xh");
  $("hit").addEventListener("pointermove", ev => {
    const rect = svg.getBoundingClientRect();
    const sx = (ev.clientX - rect.left) * W / rect.width;
    const p = Math.max(1, Math.min(xMax, Math.round(1 + (sx - m.l) / (W - m.l - m.r) * (xMax - 1))));
    xh.setAttribute("x1", X(p)); xh.setAttribute("x2", X(p)); xh.setAttribute("visibility", "visible");
    tip.innerHTML = `<div class="t">${plural(p, "parameter")} · patients needed</div>` + series.map(s => {
      const v = s.pts[p - 1][1];
      return `<div><span class="swatch" style="background:var(${SERIES[s.r.i]})"></span>R² ${fmt(s.r.v, out.scale === "cs" ? 4 : 3)}: ${Number.isFinite(v) ? v : "–"} ${v <= c.n ? "✓" : "✕"}</div>`;
    }).join("");
    tip.hidden = false;
    const px = X(p) / W * rect.width;
    tip.style.left = (px + 14 + tip.offsetWidth > rect.width ? px - 14 - tip.offsetWidth : px + 14) + "px";
    tip.style.top = "8px";
  });
  $("hit").addEventListener("pointerleave", () => { tip.hidden = true; xh.setAttribute("visibility", "hidden"); });
}

function renderR(out) {
  const c = out.cohort, s = state;
  if (!c || !out.rows.length) { $("rcode").textContent = "# Fill in the inputs to generate R code."; return; }
  const arg = out.scale === "nag" ? "nagrsquared" : "csrsquared";
  const d = out.scale === "nag" ? 3 : 4;
  const r2 = out.rows.map(r => fmt(r.v, d)).join(", ");
  const base = out.rows.find(r => r.role === "base") || out.rows[0];
  const K = out.planned ?? (base.p || 1);
  const head = out.outcome === "s"
    ? `n <- ${c.n}; events <- ${c.events}; total_py <- ${c.py}\nargs <- list(type = "s", rate = events / total_py, meanfup = total_py / n,\n             timepoint = ${c.tp}, shrinkage = ${out.shrink})`
    : `n <- ${c.n}; events <- ${c.events}\nargs <- list(type = "b", prevalence = events / n, shrinkage = ${out.shrink})`;
  const cNote = s.source === "cstat" && out.outcome === "b" && out.scale === "cs"
    ? `\n# pmsampsize can also convert the C statistic itself (simulation, may differ slightly):\n# pmsampsize(type = "b", cstatistic = ${s.cValue}, prevalence = events / n, parameters = ${K})` : "";
  $("rcode").textContent = `library(pmsampsize)
${head}

req_n <- function(p, r2) do.call(pmsampsize, c(args, list(${arg} = r2, parameters = p)))$sample_size
max_p <- function(r2) { p <- 0; while (req_n(p + 1, r2) <= n) p <- p + 1; p }

r2 <- c(${r2})
data.frame(r2 = r2, max_parameters = sapply(r2, max_p))

# Full output for ${plural(K, "parameter")} at the base-case R²
do.call(pmsampsize, c(args, list(${arg} = ${fmt(base.v, d)}, parameters = ${K})))${cNote}`;
}

// ---------------------------------------------------------------- example, sharing, copy
function isExample() {
  const keys = [...FIELDS, ...RADIOS];
  return keys.every(k => String(state[k] ?? "") === String(EXAMPLE[k] ?? "") || (typeof EXAMPLE[k] === "number" && Number(state[k]) === EXAMPLE[k]))
    && JSON.stringify(state.predictors.map(p => [p.name, p.kind, Number(p.k) || 0])) === JSON.stringify(EXAMPLE.predictors.map(p => [p.name, p.kind, Number(p.k) || 0]));
}
function writeHash() {
  if (isExample()) { history.replaceState(null, "", location.pathname + location.search); return; }
  const data = { ...Object.fromEntries([...FIELDS, ...RADIOS].map(k => [k, state[k]])), predictors: state.predictors };
  history.replaceState(null, "", "#c=" + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(data))))));
}
function loadFromHash() {
  const m = location.hash.match(/^#c=(.+)$/);
  if (!m) return null;
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))));
    const s = structuredClone(EXAMPLE);
    for (const k of [...FIELDS, ...RADIOS]) if (k in data) s[k] = data[k];
    if (Array.isArray(data.predictors)) s.predictors = data.predictors.filter(p => p && KINDS.some(([v]) => v === p.kind)).map(p => ({ name: String(p.name ?? ""), kind: p.kind, k: p.k }));
    return s;
  } catch { return null; }
}
async function copy(text, btn, done) {
  const label = btn.textContent;
  try { await navigator.clipboard.writeText(text); btn.textContent = done; }
  catch { btn.textContent = "Copy failed. Select and copy manually"; }
  setTimeout(() => (btn.textContent = label), 1800);
}
$("copyBtn").addEventListener("click", () => copy($("rcode").textContent, $("copyBtn"), "Copied"));
$("linkBtn").addEventListener("click", () => copy(location.href, $("linkBtn"), "Link copied"));
$("resetBtn").addEventListener("click", () => { state = structuredClone(EXAMPLE); selected = null; writeForm(); render(); });
$("form").addEventListener("input", e => { if (!e.target.closest(".pred")) render(); });
$("form").addEventListener("change", e => { if (!e.target.closest(".pred")) render(); });
$("form").addEventListener("submit", e => e.preventDefault());
window.addEventListener("hashchange", () => { const s = loadFromHash(); if (s) { state = s; writeForm(); render(); } });

writeForm();
render();
