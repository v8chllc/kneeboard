/** Keep one idempotency key across retries; deliberate new actions get new keys. */
export function createLoadKeyState(generate: () => string) {
  let current: string | null = null;
  return {
    newAction(): string { current = generate(); return current; },
    retry(): string {
      if (current === null) throw new Error("No load action to retry");
      return current;
    },
  };
}
