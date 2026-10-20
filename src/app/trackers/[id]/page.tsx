import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { getTrackerTransport } from "@/server/tracker-service";

import { TrackerClient } from "../../tracker-client";

export default async function TrackerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getTrackerTransport().read(await headers(), id);
  if (result.status === "found") return <TrackerClient trackerId={id} initial={result} />;
  if (result.status === "signInRequired") redirect("/");
  if (result.status === "notFound") notFound();
  if (result.status === "unreadable") {
    return <main className="tracker-shell"><h1>Tracker unavailable</h1><p>{result.message}</p>
      <p>For home flight simulation only. Not approved for real-world navigation.</p></main>;
  }
  return null;
}
