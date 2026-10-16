"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { getAccountSettings } from "@/server/account-settings";

export type SavePilotIdState = { status: "idle" | "saved" | "error"; message: string };

/** The client submits only a Pilot ID; the operation resolves account identity. */
export async function savePilotIdAction(_previous: SavePilotIdState, formData: FormData): Promise<SavePilotIdState> {
  try {
    await getAccountSettings().savePilotId(await headers(), formData.get("pilotId"));
  } catch (error) {
    if (error instanceof Error && error.message === "Pilot ID must contain 1–16 digits") {
      return { status: "error", message: "Enter 1–16 digits for your Pilot ID." };
    }
    if (error instanceof Error && error.message === "Sign-in required") {
      return { status: "error", message: "Sign in again to save your Pilot ID." };
    }
    return { status: "error", message: "Your Pilot ID could not be saved. Try again." };
  }
  revalidatePath("/");
  return { status: "saved", message: "Pilot ID saved." };
}
