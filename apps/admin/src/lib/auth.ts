import { createAuth } from "@odyssey/auth";

export const { handlers, signIn, signOut, auth } = createAuth({
  pages: { signIn: "/login" },
});
