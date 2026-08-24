import { schema } from "@four/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";

import type { AppConfig } from "./config";
import type { EmailMessage } from "./email";

const reservedUsernames = new Set([
  "admin",
  "administrator",
  "moderator",
  "root",
  "support",
  "system",
]);

function emailUsername(user: {
  displayUsername?: string | null;
  username?: string | null;
  name: string;
}) {
  return user.displayUsername ?? user.username ?? user.name ?? "Player";
}

export function createAuth(
  db: Parameters<typeof drizzleAdapter>[0],
  config: AppConfig,
  sendEmail: (message: EmailMessage) => Promise<void>,
) {
  return betterAuth({
    appName: "Four in a Row",
    baseURL: config.appOrigin,
    basePath: "/api/auth",
    secret: config.authSecret,
    trustedOrigins: [config.appOrigin],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          kind: "password-reset",
          to: user.email,
          username: emailUsername(user),
          resetUrl: url,
        });
      },
    },
    emailVerification: {
      expiresIn: 60 * 60,
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({
          kind: "verification",
          to: user.email,
          username: emailUsername(user),
          verificationUrl: url,
        });
      },
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 20,
        usernameValidator: (value) =>
          /^[a-zA-Z0-9_]+$/.test(value) && !reservedUsernames.has(value.toLowerCase()),
        displayUsernameValidator: (value) => /^[a-zA-Z0-9_]+$/.test(value),
      }),
    ],
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      useSecureCookies: config.isProduction,
      cookiePrefix: "four",
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
