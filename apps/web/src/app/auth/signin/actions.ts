"use server";

import { registerUser } from "@odyssey/auth";

export async function register(input: { name: string; email: string; password: string }) {
  try {
    await registerUser(input);
    return { success: true, error: null };
  } catch (e: any) {
    return { success: false, error: e.message ?? "Registration failed" };
  }
}
