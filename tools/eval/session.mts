// One chat with the agent, the way AnythingLLM's web interface has it: a thread (the developer API
// makes it), the first "@agent" message through the interface's own stream-chat, which answers with
// an agent session's websocket, then each next message on that socket after the server's
// WAITING_ON_INPUT. The developer API's stream-chat isn't used for the chat itself: its agent runs
// don't tell skills their thread, so a skill that keeps a tab per thread can't tell chats apart.
//
// What comes back is parsed into turns: each tool call (from AnythingLLM's "<caller> is executing
// `<tool>` tool <args>" line, which the harness's own test pins), each reply (thinking removed), the
// tab's page if a reply links one, and how the turn ended.

import type { Instance } from "./instance.mts";

export interface Call {
  tool: string;
  args: Record<string, unknown>;
}

export interface Turn {
  said: string;
  calls: Call[];
  replies: string[];
  /** Status lines that weren't tool calls (a skill's own progress, an error). */
  status: string[];
  /** "waiting": the agent answered and waits for the user; "closed", "timeout", or "no-agent". */
  ended: string;
  seconds: number;
}

const CALL = /is executing `([^`]+)` tool (\{[\s\S]*\})\s*$/;
/** The tab's page a reply links, as the browser's card puts it: [![…](…-card.jpg?v=…)](/browser-lean/<token>.html). */
const TAB = /\]\(([^)\s]*\/browser-lean\/[\w-]+\.html)\)/g;

/** A tool call from an agentThought or statusResponse line, or null. */
export function parseCall(line: string): Call | null {
  const m = CALL.exec(line);
  if (!m) return null;
  try {
    return { tool: m[1], args: JSON.parse(m[2]) };
  } catch {
    return { tool: m[1], args: {} };
  }
}

/** A reply without its thinking (<think>…</think>, which the interface folds away). */
export const visibleText = (text: string): string => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

/** The last tab's page a reply links, or null. */
export const tabOf = (text: string): string | null => [...text.matchAll(TAB)].pop()?.[1] ?? null;

export class Session {
  /** The latest tab's page any reply linked. */
  tab: string | null = null;
  readonly turns: Turn[] = [];
  private socket: WebSocket | null = null;
  private inbox: Record<string, unknown>[] = [];
  private wake: (() => void) | null = null;

  private readonly at: Instance;
  readonly workspace: string;
  readonly thread: string;
  /** How long a turn may go without a word from AnythingLLM before it counts as timed out. */
  private readonly turnMs: number;

  private constructor(at: Instance, workspace: string, thread: string, turnMs: number) {
    this.at = at;
    this.workspace = workspace;
    this.thread = thread;
    this.turnMs = turnMs;
  }

  /** A new workspace (one per case: the browser keeps its cookies and tabs per workspace) and thread. */
  static async open(at: Instance, name: string, turnMs = 300_000): Promise<Session> {
    const v1 = { Authorization: `Bearer ${at.key}`, "Content-Type": "application/json" };
    const post = async (route: string, body: object) => {
      const r = await fetch(`${at.url}/api/v1${route}`, { method: "POST", headers: v1, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`tools/eval: POST ${route}: ${r.status}`);
      return r.json();
    };
    const { workspace } = await post("/workspace/new", { name });
    const { thread } = await post(`/workspace/${workspace.slug}/thread/new`, { name });
    return new Session(at, workspace.slug, thread.slug, turnMs);
  }

  private push(m: Record<string, unknown>): void {
    this.inbox.push(m);
    this.wake?.();
  }

  private next(ms: number): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      if (this.inbox.length) return resolve(this.inbox.shift()!);
      const timer = setTimeout(() => ((this.wake = null), resolve(null)), ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve(this.inbox.shift()!);
      };
    });
  }

  /** Sends what the user says and collects the agent's turn. */
  async say(text: string): Promise<Turn> {
    const turn: Turn = { said: text, calls: [], replies: [], status: [], ended: "", seconds: 0 };
    const started = Date.now();
    if (!this.socket) {
      const r = await fetch(`${this.at.url}/api/workspace/${this.workspace}/thread/${this.thread}/stream-chat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.at.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, attachments: [] }),
      });
      const body = await r.text();
      const uuid = /"websocketUUID":"([^"]+)"/.exec(body)?.[1];
      if (!uuid) {
        turn.ended = "no-agent";
        turn.status.push(body.slice(0, 500));
        this.turns.push(turn);
        return turn;
      }
      const socket = new WebSocket(`${this.at.url.replace(/^http/, "ws")}/api/agent-invocation/${uuid}`);
      socket.onmessage = (e) => {
        try {
          this.push(JSON.parse(String(e.data)));
        } catch {}
      };
      socket.onclose = () => ((this.socket = null), this.push({ type: "closed" }));
      await new Promise((resolve, reject) => ((socket.onopen = resolve), (socket.onerror = reject)));
      this.socket = socket;
    } else this.socket.send(JSON.stringify({ type: "awaitingFeedback", feedback: text, attachments: [] }));

    for (;;) {
      const m = await this.next(this.turnMs);
      if (!m) turn.ended = "timeout";
      else if (m.type === "WAITING_ON_INPUT") turn.ended = "waiting";
      else if (m.type === "closed") turn.ended = "closed";
      if (turn.ended) break;
      if (m!.type === "statusResponse" || m!.type === "wssFailure") {
        const line = String(m!.content ?? "");
        const call = parseCall(line);
        if (call) turn.calls.push(call);
        else turn.status.push(m!.type === "wssFailure" ? `failure: ${line}` : line);
      } else if (m!.from && m!.from !== "USER" && typeof m!.content === "string") {
        const reply = visibleText(m!.content);
        turn.replies.push(reply);
        this.tab = tabOf(reply) ?? this.tab;
      }
    }
    turn.seconds = Math.round((Date.now() - started) / 1000);
    this.turns.push(turn);
    return turn;
  }

  /** Ends the agent session, as the interface's /exit does. */
  close(): void {
    this.socket?.send(JSON.stringify({ type: "awaitingFeedback", feedback: "/exit", attachments: [] }));
    this.socket?.close();
  }
}
