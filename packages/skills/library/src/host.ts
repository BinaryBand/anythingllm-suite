// What AnythingLLM supplies to the skill, as far as the skill uses it. AnythingLLM's server code is
// not a public API, so these are the skill's own description of it.

/** `this` in the handler, as AnythingLLM's agent sets it up. */
export interface HandlerContext {
  super?: {
    handlerProps?: { invocation?: { workspace?: { slug?: string } | null; thread_id?: number | null } };
    introspect?: (message: string) => void;
  };
  logger?: (message: string) => void;
}
