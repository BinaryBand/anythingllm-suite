// tools/eval: runs agent cases against a throwaway AnythingLLM with the suite installed, the live
// instance's model, and the test lab (tools/lab) as the web, then grades each from the lab's records
// and the agent's tool calls. See tools/eval/README.md.
//
//   node --disable-warning=ExperimentalWarning tools/eval/run.mts [--cases browser/*,browser/totp-*] [--parallel 2] [--repeat 1] [--keep]
//
// A case is a JSON file under cases/ (its name is its path there, without .json):
//   about    what it tests
//   site     the lab site its account is on, and where $url points
//   account  "<site>" for an account on another site (a sign-in through a provider), false for none,
//            "new" for details only (a sign-up makes the account)
//   after    a case to run right after, in the same order every time: it keeps that case's account
//            and saved logins (a new workspace, so not its cookies); otherwise the case's sites start
//            with no saved login or passkey
//   steps    in order, each one of:
//            { "say": "…" }        the user's message; the first starts the agent ("@agent …")
//            { "answer": {…} }     the user answers what the tab's page asks: the login (the
//                                  account's, or "user"/"pass" given here) or the code (looked up
//                                  in the lab by the request's wording); "save": false to not save
//            { "user": [steps] }   the stand-in user's steps on the tab's page (actor.cjs), where
//                                  "$captcha" is the digits the captcha site drew last
//            { "lab": "approvePush" }  the account's phone approves the waiting sign-in
//            { "wait": seconds }
//   expect   see grade.mts
// $url, $url_<site>, $email, $pass, $name and $phone in a step are the case's.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type CaseRecord, type Expect, grade } from "./grade.mts";
import { type Instance, ROOT, actor, forgetLogins, start } from "./instance.mts";
import * as lab from "./lab.mts";
import { Session } from "./session.mts";

interface Case {
  name: string;
  about: string;
  site: string;
  account?: string | false;
  after?: string;
  steps: Record<string, unknown>[];
  expect: Expect;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { values: opts } = parseArgs({
  options: {
    cases: { type: "string", default: "*" },
    parallel: { type: "string", default: "2" },
    repeat: { type: "string", default: "1" },
    keep: { type: "boolean", default: false },
  },
});

/** Every case under cases/, by name. */
function loadCases(): Map<string, Case> {
  const all = new Map<string, Case>();
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, f.name);
      if (f.isDirectory()) walk(file);
      else if (f.name.endsWith(".json")) {
        const name = path.relative(path.join(HERE, "cases"), file).replace(/\.json$/, "");
        all.set(name, { name, ...JSON.parse(fs.readFileSync(file, "utf8")) });
      }
    }
  };
  walk(path.join(HERE, "cases"));
  return all;
}

const glob = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);

/** The chosen cases as jobs: a case with `after` runs right after that case, in one job. */
function jobsOf(all: Map<string, Case>, patterns: string[]): Case[][] {
  const chosen = [...all.values()].filter((c) => patterns.some((p) => glob(p).test(c.name)));
  const headOf = (c: Case): Case => (c.after && all.get(c.after) ? headOf(all.get(c.after)!) : c);
  const jobs = new Map<string, Case[]>();
  for (const c of chosen) {
    const chain: Case[] = [];
    for (let at: Case | undefined = c; at; at = at.after ? all.get(at.after) : undefined) chain.unshift(at);
    const head = headOf(c).name;
    const job = jobs.get(head) ?? [];
    for (const step of chain) if (!job.includes(step)) job.push(step);
    jobs.set(head, job);
  }
  return [...jobs.values()];
}

const fill = (text: string, vars: Record<string, string>): string => text.replace(/\$(url_\w+|url|email|pass|name|phone|captcha)/g, (m, k) => vars[k] ?? m);

const fillAll = (value: unknown, vars: Record<string, string>): unknown =>
  typeof value === "string" ? fill(value, vars) : Array.isArray(value) ? value.map((v) => fillAll(v, vars)) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillAll(v, vars)])) : value;

const log = (name: string, line: string) => console.log(`[${name}] ${line}`);

/** Runs one case: its workspace, its steps, the lab's record. */
async function runCase(at: Instance, c: Case, run: string, rep: number, accounts: Map<string, lab.Account>): Promise<CaseRecord & { expect: Expect; account?: string }> {
  const started = new Date().toISOString();
  const tag = `${run}-${c.name.replace(/\W+/g, "-")}-${rep}`;
  const inherited = c.after ? accounts.get(c.after) : undefined;
  const a = inherited ?? (c.account === false ? null : lab.account(c.account && c.account !== "new" ? c.account : c.site, tag, c.account !== "new"));
  if (a) accounts.set(c.name, a);
  const vars: Record<string, string> = { url: lab.urlOf(c.site), email: a?.email ?? "", pass: a?.pass ?? "", name: a?.name ?? "", phone: a?.phone ?? "" };
  for (const m of JSON.stringify(c.steps).matchAll(/\$url_(\w+)/g)) vars[`url_${m[1]}`] = lab.urlOf(m[1]);
  if (!c.after) await forgetLogins(at, [...new Set([c.site, ...(typeof c.account === "string" && c.account !== "new" ? [c.account] : [])])].map((s) => new URL(lab.urlOf(s)).host));

  const record: CaseRecord & { expect: Expect; account?: string } = { name: c.name, turns: [], asked: [], lab: {}, secrets: a ? [a.pass] : [], seconds: 0, account: a?.email, expect: fillAll(c.expect, vars) as Expect };
  const session = await Session.open(at, `eval ${c.name} ${rep}`);
  try {
    for (const step of c.steps.map((s) => fillAll(s, vars) as Record<string, any>)) {
      if (step.say) {
        log(c.name, `> ${step.say}`);
        const turn = await session.say(step.say);
        for (const call of turn.calls) log(c.name, `  ${call.tool} ${JSON.stringify(call.args)}`);
        log(c.name, `  < ${(turn.replies.at(-1) ?? "").replace(/\s+/g, " ").slice(0, 160)} (${turn.seconds} s, ${turn.ended})`);
        if (turn.ended !== "waiting") break;
      } else if (step.answer) {
        if (!session.tab) {
          record.asked.push({ none: "no tab's page" });
          continue;
        }
        let need: Record<string, unknown> | null = null;
        for (let i = 0; i < 15 && !need; i++) {
          need = JSON.parse(actor(at, [session.tab, JSON.stringify([{ state: true }])]).replace(/^STATE /, "")).need;
          if (!need) await new Promise((r) => setTimeout(r, 2000));
        }
        record.asked.push(need ?? { none: "nothing asked" });
        if (!need) {
          log(c.name, "~ the tab's page asks for nothing");
          continue;
        }
        const code = need.kind === "code" ? lab.codeFor(a!, String(need.label ?? need.text)) : undefined;
        if (code) record.secrets.push(code);
        log(c.name, `~ the tab's page asks: ${need.kind}${need.confirm ? " (new password)" : ""}: ${need.text}`);
        actor(at, [session.tab, JSON.stringify([{ answer: { user: step.answer.user ?? a?.email, pass: step.answer.pass ?? a?.pass, code, save: step.answer.save } }])]);
      } else if (step.user) {
        const steps = fillAll(step.user, { captcha: lab.captcha() });
        log(c.name, `~ user ${JSON.stringify(steps)}`);
        if (session.tab) log(c.name, `  ${actor(at, [session.tab, JSON.stringify(steps)]).replace(/\n/g, " ")}`);
      } else if (step.lab === "approvePush") {
        let ok = false;
        for (let i = 0; i < 20 && !(ok = lab.approvePush(a!)); i++) await new Promise((r) => setTimeout(r, 1500));
        log(c.name, `~ the phone ${ok ? "approved the sign-in" : "had nothing to approve"}`);
      } else if (step.wait) await new Promise((r) => setTimeout(r, Number(step.wait) * 1000));
    }
  } catch (e) {
    record.error = e instanceof Error ? e.message : String(e);
  } finally {
    session.close();
  }
  record.turns = session.turns;
  record.seconds = Math.round((Date.now() - Date.parse(started)) / 1000);
  if (a && c.expect.signedIn !== undefined) {
    const site = typeof c.expect.signedIn === "object" ? c.expect.signedIn.site : c.site;
    record.lab.signedIn = lab.signedIn(site, a.email, started);
  }
  if (a && c.expect.exists !== undefined) record.lab.exists = lab.exists(c.site, a.email);
  return record;
}

/** The lab sites a job's cases touch: never two jobs on one site at once, since saved logins are
 *  the instance's and a case clears its sites' as it starts. */
const sitesOf = (job: Case[]): string[] => [...new Set(job.flatMap((c) => [c.site, ...(typeof c.account === "string" && c.account !== "new" ? [c.account] : [])]))];

/** Runs the jobs, at most `n` at a time and one at a time per site. */
async function pool(jobs: { sites: string[]; run: () => Promise<void> }[], n: number): Promise<void> {
  const busy = new Set<string>();
  const waiting = [...jobs];
  const sleepers: (() => void)[] = [];
  const free = () => waiting.findIndex((j) => j.sites.every((s) => !busy.has(s)));
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (waiting.length) {
      const i = free();
      if (i < 0) {
        await new Promise<void>((r) => sleepers.push(r));
        continue;
      }
      const [job] = waiting.splice(i, 1);
      job.sites.forEach((s) => busy.add(s));
      try {
        await job.run();
      } finally {
        job.sites.forEach((s) => busy.delete(s));
        sleepers.splice(0).forEach((r) => r());
      }
    }
  }));
}

const all = loadCases();
const jobs = jobsOf(all, opts.cases!.split(","));
if (!jobs.length) {
  console.error(`tools/eval: no case matches ${opts.cases}; the cases are:\n  ${[...all.keys()].sort().join("\n  ")}`);
  process.exit(2);
}
const run = Date.now().toString(36);
const out = path.join(HERE, "results", run);
fs.mkdirSync(out, { recursive: true });
console.log(`tools/eval: run ${run}, ${jobs.flat().length} cases in ${jobs.length} jobs, ${opts.parallel} at a time, ${opts.repeat}× each`);
const at = await start();
console.log(`tools/eval: AnythingLLM at ${at.url} (${at.name})`);
const results: (CaseRecord & { grade: ReturnType<typeof grade> })[] = [];
try {
  const work = Array.from({ length: Number(opts.repeat) }, (_, rep) =>
    jobs.map((job) => ({ sites: sitesOf(job), run: async () => {
      const accounts = new Map<string, lab.Account>();
      for (const c of job) {
        const r = await runCase(at, c, run, rep + 1, accounts);
        const g = grade(r, r.expect);
        results.push({ ...r, grade: g });
        fs.appendFileSync(path.join(out, "records.jsonl"), JSON.stringify({ ...r, repeat: rep + 1, grade: g }) + "\n");
        log(c.name, `${g.status.toUpperCase()}${g.status === "pass" ? "" : ": " + g.checks.filter((k) => !k.ok).map((k) => k.name + (k.detail ? ` (${k.detail})` : "")).join("; ")}`);
      }
    } })),
  ).flat();
  await pool(work, Number(opts.parallel));
} finally {
  at.stop(opts.keep);
  if (opts.keep) console.log(`tools/eval: kept the run's storage (${at.storage}) and its lab accounts (eval-${run}-…)`);
  else lab.removeRun(run);
}

// The report: one row per case, its passes over its repeats.
const byCase = new Map<string, typeof results>();
for (const r of results) byCase.set(r.name, [...(byCase.get(r.name) ?? []), r]);
const rows = [...byCase].sort(([x], [y]) => x.localeCompare(y)).map(([name, rs]) => {
  const pass = rs.filter((r) => r.grade.status === "pass").length;
  const infra = rs.filter((r) => r.grade.status === "infra").length;
  const why = [...new Set(rs.flatMap((r) => r.grade.checks.filter((k) => !k.ok).map((k) => k.name)))].join("; ");
  const calls = Math.round(rs.reduce((n, r) => n + r.turns.flatMap((t) => t.calls).length, 0) / rs.length);
  return `| ${name} | ${pass}/${rs.length - infra}${infra ? ` (+${infra} infra)` : ""} | ${calls} | ${Math.round(rs.reduce((n, r) => n + r.seconds, 0) / rs.length)} s | ${why} |`;
});
const report = [`# Eval run ${run}`, "", `${new Date().toISOString()}, AnythingLLM ${at.url}, ${opts.repeat}× each.`, "", "| Case | Passed | Calls | Time | Failed checks |", "| --- | --- | --- | --- | --- |", ...rows, ""].join("\n");
fs.writeFileSync(path.join(out, "report.md"), report);
console.log("\n" + report + `\nRecords: ${path.relative(ROOT, out)}/records.jsonl`);
process.exit(results.every((r) => r.grade.status !== "fail") ? 0 : 1);
