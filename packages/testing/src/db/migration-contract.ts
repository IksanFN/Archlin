import pg from 'pg';
import type { TestDbUrls } from './urls';

// Pre-auth tables hold credentials and audit data about people who are not signed in yet. They are reachable only
// through the SECURITY DEFINER gateway, so cortex_app must have no privilege on them at all.
const PREAUTH_TABLES: ReadonlySet<string> = new Set(['auth_challenges', 'auth_attempts']);
const PLATFORM_NAMESPACE = 'platform';

interface TableRow {
  table_name: string;
  rls: boolean;
  owner: string;
  app_truncate: boolean;
  app_references: boolean;
  app_trigger: boolean;
  app_table_privilege: boolean;
  app_column_privilege: boolean;
  public_privilege: boolean;
}

interface PolicyRow {
  table_name: string;
  qual: string | null;
  check_expr: string | null;
}

// Every public table that carries an owner or user column.
const TABLES_SQL = `
  select c.relname as table_name,
    c.relrowsecurity as rls,
    pg_get_userbyid(c.relowner) as owner,
    has_table_privilege('cortex_app', c.oid, 'TRUNCATE') as app_truncate,
    has_table_privilege('cortex_app', c.oid, 'REFERENCES') as app_references,
    has_table_privilege('cortex_app', c.oid, 'TRIGGER') as app_trigger,
    has_table_privilege('cortex_app', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as app_table_privilege,
    has_any_column_privilege('cortex_app', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES') as app_column_privilege,
    exists (select 1 from aclexplode(c.relacl) a where a.grantee = 0) as public_privilege
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and exists (
      select 1 from pg_attribute at
      where at.attrelid = c.oid and at.attname in ('owner_id', 'user_id') and at.attnum > 0 and not at.attisdropped
    )
  order by c.relname`;

// Policies that apply to cortex_app, directly or through PUBLIC.
const POLICIES_SQL = `
  select c.relname as table_name,
    pg_get_expr(p.polqual, p.polrelid) as qual,
    pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and (0 = any (p.polroles) or (select oid from pg_roles where rolname = 'cortex_app') = any (p.polroles))`;

const mentionsOwnerSetting = (expression: string | null): boolean => expression?.includes('app.owner_id') ?? false;

// Executable form of the module migration contract (spec 13.4 K3). Throws one Error listing every violation.
export async function assertModuleMigrationContract(options: {
  urls: TestDbUrls;
  namespace: string;
  tablesCreated: readonly string[];
}): Promise<void> {
  const { urls, namespace, tablesCreated } = options;
  const problems: string[] = [];

  // Platform tables are unprefixed (users, sessions); a module's tables carry its id.
  if (namespace !== PLATFORM_NAMESPACE) {
    for (const table of tablesCreated) {
      if (!table.startsWith(`${namespace}_`)) {
        problems.push(`${table}: table of module "${namespace}" must be prefixed "${namespace}_"`);
      }
    }
  }

  const client = new pg.Client({ connectionString: urls.super });
  await client.connect();
  let tables: TableRow[];
  let policies: PolicyRow[];
  try {
    tables = (await client.query<TableRow>(TABLES_SQL)).rows;
    policies = (await client.query<PolicyRow>(POLICIES_SQL)).rows;
  } finally {
    await client.end();
  }

  for (const table of tables) {
    const name = table.table_name;
    if (table.public_privilege) problems.push(`${name}: PUBLIC must not hold any table privilege`);

    if (PREAUTH_TABLES.has(name)) {
      if (table.app_table_privilege || table.app_column_privilege) {
        problems.push(`${name}: pre-auth table must not be accessible to cortex_app`);
      }
      continue;
    }

    if (!table.rls) problems.push(`${name}: row level security is not enabled`);
    const own = policies.filter((p) => p.table_name === name);
    if (own.length === 0) {
      problems.push(`${name}: no policy applies to cortex_app`);
    }
    for (const policy of own) {
      if (!mentionsOwnerSetting(policy.qual) || (policy.check_expr !== null && !mentionsOwnerSetting(policy.check_expr))) {
        problems.push(`${name}: every policy for cortex_app must be bound to app.owner_id`);
        break;
      }
    }
    if (table.app_truncate) problems.push(`${name}: cortex_app must not hold TRUNCATE`);
    if (table.app_references) problems.push(`${name}: cortex_app must not hold REFERENCES`);
    if (table.app_trigger) problems.push(`${name}: cortex_app must not hold TRIGGER`);
    if (table.owner === 'cortex_app') problems.push(`${name}: table must not be owned by cortex_app`);
  }

  if (problems.length > 0) {
    throw new Error(`Migration contract violated:\n- ${problems.join('\n- ')}`);
  }
}
