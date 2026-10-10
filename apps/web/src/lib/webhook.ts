import { env } from "./env";

export function webhookUrl(recipeId: string, secret: string) {
  return `${env.publicUrl}/api/hooks/${recipeId}/${secret}`;
}
