// What AnythingLLM supplies to the skill, as far as the skill uses it. AnythingLLM's server code is
// not a public API, so these are the skill's own description of it.

interface Question {
  kind: string;
  question: string;
  inputType?: string;
  placeholder?: string;
}

interface Clarification {
  answers?: { answer?: string | null; skipped?: boolean }[];
  skipped?: boolean;
  timedOut?: boolean;
}

/** `this` in the handler, as AnythingLLM's agent sets it up. */
export interface HandlerContext {
  super?: {
    handlerProps?: { invocation?: { workspace?: { slug?: string } | null; thread_id?: number | null } };
    introspect?: (message: string) => void;
    /** AnythingLLM's question card, only in its own chat window: the answers come to the skill. */
    requestUserClarification?: (ask: { questions: Question[]; allowSkip: boolean; timeoutMs: number }) => Promise<Clarification>;
    addClarifyingQuestionSurvey?: (survey: { questions: Question[]; result: Clarification }) => void;
  };
  /** The skill's settings (plugin.json's setup_args), as the user set them in AnythingLLM. */
  runtimeArgs?: Record<string, string | undefined>;
  logger?: (message: string) => void;
}
