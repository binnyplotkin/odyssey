"use server";

import { registerUser } from "@odyssey/auth";

export async function register(input: { name: string; email: string; password: string }) {
  try {
    await registerUser(input);
    return { success: true, error: null };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Registration failed",
    };
  }
}
