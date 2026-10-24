"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RecentLoadsRetry() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return <button type="button" disabled={pending}
    onClick={() => startTransition(() => router.refresh())}
    className="rounded-md border border-zinc-500 px-4 py-2 font-medium hover:bg-zinc-800 disabled:opacity-50">
    {pending ? "Retrying…" : "Retry recent loads"}
  </button>;
}
