import { parseArgs } from "node:util";
import { getPool } from "@/lib/db";
import { createUserWithPassword, temporaryPassword } from "@/lib/users";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string", default: "" },
    password: { type: "string" },
  },
});

if (!values.email) {
  console.error("usage: create-user --email someone@example.com [--name \"Their Name\"] [--password temp-password]");
  process.exit(1);
}

const password = values.password ?? temporaryPassword();

try {
  const user = await createUserWithPassword({ email: values.email, name: values.name ?? "", password });
  console.log(`created ${user.email}`);
  console.log(`temporary password: ${password}`);
  console.log("they must change it at first sign-in");
} catch (error) {
  console.error(`could not create user: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await getPool().end();
}
