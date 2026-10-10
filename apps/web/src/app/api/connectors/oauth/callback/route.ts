import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { abandonSignIn, finishSignIn, safeReturnPath } from "@/server/connector-oauth";
import { forgetServer, testConnection } from "@/server/upstream";

function back(returnTo: string | null, outcome?: string) {
  const target = new URL(safeReturnPath(returnTo) ?? "/", env.publicUrl);
  if (outcome) target.searchParams.set("signin", outcome);
  return redirect(target.toString());
}

export async function GET(request: Request) {
  const user = await requireUser();
  const params = new URL(request.url).searchParams;
  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";
  if (!state) return back(null);
  if (!code) {
    const abandoned = await abandonSignIn(state, user.id);
    return back(abandoned?.returnTo ?? null, abandoned ? "refused" : undefined);
  }
  const finished = await finishSignIn(state, code, user.id);
  if (!finished) return back(null);
  forgetServer(finished.server.id);
  const test = finished.signedIn ? await testConnection(finished.server, user.id) : null;
  return back(finished.returnTo, test?.ok ? "done" : "failed");
}
