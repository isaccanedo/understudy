import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { accountSource, grantsAdmin, shouldAutoApprove, signUpRefusal } from "./approval-policy";
import { getDb, schema } from "./db";
import { env, isAdmin, isAdminEmail, isAllowedEmail } from "./env";
import { messages } from "./messages";

function createAuth() {
  return betterAuth({
    baseURL: env.publicUrl,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    socialProviders: env.googleEnabled
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID as string,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
            hd: env.allowedEmailDomains.length === 1 ? env.allowedEmailDomains[0] : undefined,
          },
        }
      : {},
    user: {
      additionalFields: {
        status: { type: "string", defaultValue: "pending", input: false },
        mustChangePassword: { type: "boolean", defaultValue: false, input: false },
        admin: { type: "boolean", defaultValue: false, input: false },
        source: { type: "string", required: false, input: false },
      },
    },
    session: {
      cookieCache: { enabled: false },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            if (!isAllowedEmail(user.email)) {
              throw new APIError("FORBIDDEN", { message: messages.auth.domainNotAllowed(env.allowedEmailDomains) });
            }
            const source = accountSource(context?.path, (user as { source?: unknown }).source);
            const adminEmail = isAdminEmail(user.email);
            const refusal = signUpRefusal({ source, isAdminEmail: adminEmail, allowedDomains: env.allowedEmailDomains });
            if (refusal) {
              console.error(JSON.stringify({ event: "sign_up_refused", reason: refusal }));
              throw new APIError("FORBIDDEN", { message: refusal === "sign_up_closed" ? messages.auth.signUpClosed : messages.auth.signUpFailed });
            }
            const emailVerified = source === "sign_up" ? false : user.emailVerified === true;
            const policy = { source, emailVerified, isAdminEmail: adminEmail };
            return {
              data: {
                ...user,
                emailVerified,
                source,
                status: shouldAutoApprove({ ...policy, allowedDomains: env.allowedEmailDomains }) ? "approved" : "pending",
                admin: grantsAdmin(policy),
              },
            };
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;

const store = globalThis as unknown as { __understudyAuth?: Auth };

export function getAuth(): Auth {
  store.__understudyAuth ??= createAuth();
  return store.__understudyAuth;
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  status: string;
  mustChangePassword: boolean;
  admin: boolean;
  source?: string | null;
};

export async function sessionFromHeaders(headers: Headers): Promise<SessionUser | null> {
  const result = await getAuth().api.getSession({ headers });
  if (!result) return null;
  const u = result.user as SessionUser;
  return { id: u.id, name: u.name, email: u.email, image: u.image, status: u.status, mustChangePassword: Boolean(u.mustChangePassword), admin: isAdmin(u.email, Boolean(u.admin), u.source) };
}
