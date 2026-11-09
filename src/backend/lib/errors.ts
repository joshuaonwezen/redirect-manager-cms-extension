/** A refusal the UI shows as it is, e.g. a rule that would make a loop. */
export class ActionError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
  }
}
