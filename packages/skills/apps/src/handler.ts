// Apps: small things a user keeps in a workspace (a list, habits, a calendar, anything with a JSON
// shape), kept by this skill alone inside AnythingLLM's storage, with no server of its own. Each
// call works on the workspace AnythingLLM invoked it from and answers text for the agent, with the
// app's card in Markdown to put in its reply.

import { Told } from "#shared/errors";
import { card, headline } from "./card.ts";
import type { HandlerContext } from "./host.ts";
import { collect, described, keyForPages, pageUrl, publish, refresh, unpublish } from "./page.ts";
import type { Json } from "./patch.ts";
import * as parts from "./parts.ts";
import { withDefaults } from "./schema.ts";
import { scopeOf, type Scope } from "./scope.ts";
import * as store from "./store.ts";
import { AppError } from "./store.ts";

type Args = Record<string, Json>;
type Action = (scope: Scope, p: Args, self: HandlerContext) => string | Promise<string>;

const NO_STARTER = ["blank", "custom", "none", "empty"];
const RECENT = 5;

/** A value the model may have sent as JSON text, read as JSON. */
function asJson(value: Json, what: string): Json {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new AppError(`${what} must be JSON`);
  }
}

/** The address the user's browser reaches AnythingLLM at, from the skill's settings. */
function baseOf(self: HandlerContext): string | null {
  const base = String(self?.runtimeArgs?.ANYTHINGLLM_URL || "").trim();
  return /^https?:\/\/[^\s/]+/.test(base) ? base : null;
}

// A sentence leads into the card rather than a label: a model copies a label line ("Card:") into
// its reply along with the card.
const cardBlock = (app: Json, url: string | null): string[] => ["", "Put the card below in your reply exactly as given, with no label or heading.", ...card(app, url)];
/** The address of an app's page, once it has one and the address is set. */
const urlOf = (self: HandlerContext, app: Json): string | null => pageUrl(app.pageToken, baseOf(self));
const cardOf = (self: HandlerContext, app: Json): string[] => cardBlock(app, urlOf(self, app));

/** What the agent should still fix about an app's page, as lines; none when nothing. */
const advice = (app: Json): string[] => [parts.colourNote(app.page, app.rules)].filter(Boolean);

/** How to make a new app, which list answers with, since the agent lists first. */
const MAKING = (): string[] => [
  `To make one: if a starter fits (${Object.keys(parts.starters()).join(", ")}), create with starter and title, then fit it with edit and do.`,
  "Otherwise guide, then guide once with every part you'll use, then create with a template, the parts, text (app.json: about, rules, card) and a plan, and fit it with edit.",
  "Make one app and fit it with edit; a second only if the user asks.",
];

const PLAN_MIN = 40;
const PLAN_MAX = 600;
/** What a plan covers, which a create without a starter is refused with when it has none: the
 *  things an agent building from scratch overlooks, since nothing else makes it stop. */
const PLAN_NEEDS =
  `plan: ${PLAN_MIN}-${PLAN_MAX} characters on how you'll build this, covering what the app keeps; data it needs from outside (a word list, rules) and how you'll get it: with the workspace's web skills first if it has them, or by the page fetching it, rather than from memory; ` +
  "how time works (nothing runs while the page is closed: something daily is worked out from the date in the page); whether it is used on more than one device (a page's changes reach the app only at the next Apps call); " +
  "logic you can't run here (there is no browser check) and how you checked it by hand; and anything to tell the user";

const changeLine = (h: Json): string => `- ${h.t} ${h.ev}${h.fields ? ` ${JSON.stringify(h.fields)}` : ""}`;

const ACTIONS: Record<string, Action> = {
  list: ({ workspace }, _p, self) => {
    const apps = store.list(workspace);
    const listed = apps.length
      ? ["This workspace's apps (change one that fits rather than making another):", ...apps.map((a) => (a.broken ? `- ${a.name}: can't be read` : `- ${a.name}: ${headline(a, urlOf(self, a))}`))]
      : ["This workspace has no apps yet."];
    return [...listed, "", ...MAKING()].join("\n");
  },
  create: async ({ workspace, thread }, p, self) => {
    // A starter (or a template named like one) makes a working app; else a template with the
    // components in parts composed in, their schemas merged and their first data; text (app.json)
    // adds to or replaces what those give. Every problem comes back at once, so one more call can
    // fix them all.
    const problems: string[] = [];
    const json = (value: Json, what: string) => {
      try {
        return asJson(value, what);
      } catch (e) {
        problems.push((e as Error).message);
        return undefined;
      }
    };
    const given = p.text;
    const { definition = {}, data: inText } = given === undefined ? {} : store.definitionFrom(given, problems, true);
    // A model reaches for "blank" or "custom" to mean no starter: a template and parts then.
    const starter = NO_STARTER.includes(String(p.starter).toLowerCase()) ? undefined : p.starter;
    const named = starter !== undefined ? (parts.starterNamed(starter) ?? starter) : parts.starterNamed(p.template);
    const used = typeof p.parts === "string" && !p.parts.trim().startsWith("[") ? p.parts.split(/[\s,]+/).filter(Boolean) : (json(p.parts, "parts") ?? []);
    let base: Json = null;
    if (named !== undefined) {
      base = parts.starter(named);
      if (!base) problems.push(`starter must be one of: ${Object.keys(parts.starters()).join(", ")}`);
    } else {
      if (given === undefined && !used.length) problems.push("create needs starter, or a template with parts (components), or text: app.json's about, rules, schema and card");
      try {
        const made = parts.assemble(p.template || undefined, used);
        base = { template: p.template || parts.DEFAULT_TEMPLATE, parts: used, definition: used.length ? { schema: made.schema } : {}, data: made.data, page: made.page };
      } catch (e) {
        problems.push((e as Error).message);
      }
    }
    // Last, so the other problems read as they did; a starter is known to work and needs none.
    const chars = typeof p.plan === "string" ? [...p.plan.trim()] : [];
    if (named === undefined && (chars.length < PLAN_MIN || chars.length > PLAN_MAX)) problems.push(PLAN_NEEDS);
    const plan = chars.slice(0, PLAN_MAX).join("");
    const object = (v: Json) => v && typeof v === "object" && !Array.isArray(v);
    const sent = json(p.data, "data") ?? inText;
    const schema = definition.schema ?? base?.definition.schema;
    const { value: data, filled } = object(sent) ? withDefaults({ ...base?.data, ...sent }, schema) : { value: sent ?? base?.data, filled: [] as string[] };
    const name = p.name ?? store.freeName(workspace, p.title || definition.title || named);
    const made = await store.create(
      workspace,
      name,
      { card: {}, ...base?.definition, ...definition, title: p.title || definition.title || base?.definition.title || name, data, page: base?.page, ...(plan ? { plan } : {}) },
      thread,
      problems,
    );
    const how =
      named !== undefined
        ? `from the ${named} starter: the ${base.template} template with ${parts.partsText(base.parts)}, working as it is.`
        : used.length
          ? `from the ${base.template} template with ${parts.partsText(used)}: composed, their schemas merged and their first data in.`
          : `from the ${base.template} template, which holds no components yet: put each one's markup at <!--slot--> and its script at <!--scripts-->.`;
    // The page goes up as the app is made, and is written again after every change, so its link can
    // go in the reply that makes the app; an agent left to call page for it may not.
    const address = baseOf(self);
    const url = address ? await publish(made, workspace, address) : null;
    const defaults = filled.length ? [`Filled in what the data left out: ${filled.join(", ")}, with false, 0 or [].`] : [];
    return [
      `Made the app ${made.name}: ${made.title}, ${how} Fit it to what the user asked with edit (page.html, app.json) and do (the data)${url ? "." : ", then give them the page."}`,
      ...defaults,
      ...(url ? [`Its page is at ${url} and follows every change; the card's title opens it.`] : []),
      "",
      "app.json:",
      store.definitionText(made),
      "page.html:",
      made.page,
      "Before giving the user the page:",
      parts.guide("finish"),
      ...cardBlock(made, url),
    ].join("\n");
  },
  do: async ({ workspace, thread }, p, self) => {
    const patch = asJson(p.patch, "patch");
    const fields = asJson(p.fields, "fields");
    const app = await store.change(workspace, p.name, { patch, ev: p.ev, fields, thread });
    return [`Done: ${app.history[app.history.length - 1].ev} on ${app.name}.`, ...cardOf(self, app)].join("\n");
  },
  read: ({ workspace }, p, self) => {
    if (p.file) {
      const text = store.readFile(workspace, p.name, p.file);
      return text === null
        ? `${p.name} has no ${p.file} yet; write it from a template (guide).`
        : `${p.name}'s ${p.file} (change it with edit: a find and its text, or the whole file with no find):\n${text}`;
    }
    const app = store.read(workspace, p.name);
    const history: Json[] = app.history || [];
    return [
      `${app.name}'s app.json: ${JSON.stringify(parts.definitionOf(app))}`,
      `Line ${app.line || 0}, made ${app.made}, changed ${app.changed}${app.page ? "; read with file page.html gives the page" : "; it has no page.html yet"}.`,
      ...(app.plan ? [`Plan: ${app.plan}`] : []),
      `Data: ${JSON.stringify(app.data)}`,
      history.length ? `Newest changes (${history.length} kept; undo takes back the newest, to the data or a file):` : "No changes yet.",
      ...history.slice(-RECENT).reverse().map(changeLine),
      ...(app.versions?.length ? ["Earlier files (undo with file takes back the newest change to one):", ...app.versions.slice(-RECENT).reverse().map((v: Json) => `- ${v.t} ${v.file}`)] : []),
      ...cardOf(self, app),
    ].join("\n");
  },
  page: async ({ workspace }, p, self) => {
    const app = store.read(workspace, p.name);
    if (!app.page) return `${app.name} has no page.html yet: write one from a template and its components (guide), then try again.`;
    const base = baseOf(self);
    if (!base)
      return "A page needs the address the user's browser reaches AnythingLLM at. Ask them to set it in AnythingLLM's Agent Skills, under Apps, as ANYTHINGLLM_URL (such as https://my-server:3001), then try again.";
    const url = await publish(app, workspace, base);
    if (!url)
      return [
        `${app.title}'s page can't be published here: AnythingLLM's public folder can't be written (as in AnythingLLM Desktop). The app works from the chat with do; tell the user its page isn't available on this instance.`,
        ...cardOf(self, app),
      ].join("\n");
    return [
      `${app.title}'s page is at ${url}. It opens in the user's browser, always shows the app as it is now, and saves taps back to AnythingLLM; they reach the app the next time any Apps action runs.`,
      ...cardBlock(app, url),
    ].join("\n");
  },
  undo: async ({ workspace }, p, self) => {
    const app = store.read(workspace, p.name);
    const data = app.history?.at(-1), file = app.versions?.at(-1);
    if (p.file || (file && (!data || file.t > data.t))) {
      const { app: next, reverted } = await store.revert(workspace, p.name, p.file || undefined);
      return [`Put back ${next.name}'s ${reverted.file} as it was before its change at ${reverted.t}.`, ...cardOf(self, next)].join("\n");
    }
    const { app: next, undone } = await store.undo(workspace, p.name);
    return [`Took back ${undone.ev} (${undone.t}) on ${next.name}.`, ...cardOf(self, next)].join("\n");
  },
  edit: async ({ workspace }, p, self) => {
    const whole = p.find === undefined || p.find === "";
    const app = whole ? await store.writeFile(workspace, p.name, p.file, p.text) : await store.editFile(workspace, p.name, p.file, p.find, p.text);
    return [`${whole ? "Wrote" : "Changed"} ${app.name}'s ${p.file}.`, ...advice(app), ...cardOf(self, app)].join("\n");
  },
  delete: async ({ workspace }, p, self) => {
    const app = store.read(workspace, p.name);
    // AnythingLLM pauses the agent and asks the user; without a way to ask (a scheduled job) it
    // answers approved, as its own tools do.
    if (typeof self?.requestToolApproval === "function") {
      const { approved, message } = await self.requestToolApproval({ payload: { name: app.name }, description: `Delete the app ${app.title} and its changes?` });
      if (!approved) return `The user kept ${app.name}${message ? `: ${message}` : "."}`;
    }
    await store.remove(workspace, app.name);
    unpublish(app);
    return `Deleted the app ${app.name}, its changes and its page.`;
  },
  guide: (_scope, p) => {
    const topic = String(p.query || "").trim();
    if (!topic) return parts.file("guide.md") + "\n" + parts.guide();
    try {
      return parts.guide(topic);
    } catch (e) {
      throw new AppError((e as Error).message);
    }
  },
};

/** Actions that change an app named in the call, after which its page is written again. */
const CHANGES = new Set(["do", "undo", "edit"]);

async function run(self: HandlerContext, params: Args): Promise<string> {
  const action = params.action || "list";
  const act = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
  if (!act) throw new AppError(`action is one of ${Object.keys(ACTIONS).join(", ")}`);
  const scope = scopeOf(self);
  // Changes made on app pages wait as event documents until the skill next runs.
  const fromPages = action === "guide" ? [] : await collect();
  const reply = await act(scope, params, self);
  const base = baseOf(self);
  if (base) {
    const touched = new Map(fromPages.filter((r) => r.ok).map((r) => [`${r.workspace}/${r.app}`, { workspace: r.workspace!, app: r.app! }]));
    if (CHANGES.has(action) && params.name) touched.set(`${scope.workspace}/${params.name}`, { workspace: scope.workspace, app: params.name });
    // One key for every page, asked for when the first needs it.
    let asked: Promise<string> | undefined;
    const key = () => (asked ??= keyForPages());
    for (const { workspace, app } of touched.values()) await refresh(workspace, app, base, key);
  }
  const lines = described(fromPages, scope.workspace);
  return lines.length ? [...lines, "", reply].join("\n") : reply;
}

export const runtime = {
  handler: async function (this: HandlerContext, params: Args = {}): Promise<string> {
    try {
      return await run(this, params);
    } catch (e) {
      if (e instanceof Told) return `Apps: ${e.message}`;
      this?.logger?.(`apps-lean: ${(e as Error)?.stack || e}`);
      return `Apps failed: ${(e as Error)?.message || e}`;
    }
  },
};
