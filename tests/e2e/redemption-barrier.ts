type WaitingBackend = { pid: number };

/** Both independent app processes must be waiting on verification persistence. */
export function twoRedemptionsWaiting(backends: WaitingBackend[]): boolean {
  return new Set(backends.map((backend) => backend.pid)).size >= 2;
}
