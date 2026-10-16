import { Told } from "#shared/errors";

/** A refusal or a mistake to tell the agent as it is. */
export class BrowserError extends Told {}

/** A ref that isn't on the page any more: the agent reads again; the user, typing, taps again. */
export class StaleRef extends BrowserError {}
