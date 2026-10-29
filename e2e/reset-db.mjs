import { execFileSync } from "node:child_process";

// Empties the local e2e database (before its API starts) so leftovers never skew the tests.
// Hard-wired to the local code-postgres-1 container and the e2e database, and guarded again in SQL.
const RESET_SQL = `DO $$ DECLARE t record; BEGIN
  IF current_database() <> 'e2e' THEN RAISE EXCEPTION 'refusing to reset %', current_database(); END IF;
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' LOOP
    EXECUTE 'TRUNCATE TABLE ' || quote_ident(t.tablename) || ' CASCADE';
  END LOOP;
END $$;`;

try {
  execFileSync("docker", ["exec", "code-postgres-1", "psql", "-U", "app", "-d", "e2e", "-v", "ON_ERROR_STOP=1", "-c", RESET_SQL], { stdio: "ignore" });
  console.log("e2e database reset");
} catch {
  console.log("e2e database not reset (Docker or the database is not available yet)");
}
