// Client de test imitant le sous-ensemble de supabase-js utilisé par les fonctions, branché sur un vrai
// PostgreSQL (contraintes, triggers et fonctions SQL réels). Non livré en production.
import pg from "npm:pg@8.13.1";

const { Pool, types } = pg;
types.setTypeParser(1700, (v: string) => parseFloat(v));                    // numeric → nombre (comme PostgREST)
types.setTypeParser(20, (v: string) => Number(v));                          // int8
types.setTypeParser(1184, (v: string) => new Date(v).toISOString());        // timestamptz → ISO
types.setTypeParser(1114, (v: string) => new Date(v + "Z").toISOString());
types.setTypeParser(1082, (v: string) => v);                                // date → texte

let pool: InstanceType<typeof Pool> | null = null;
const colCache = new Map<string, Map<string, string>>();
const fnCache = new Map<string, { set: boolean; composite: boolean }>();
export const storage = new Map<string, Uint8Array>();

export async function useDatabase(database: string): Promise<void> {
  if (pool) await pool.end();
  colCache.clear(); fnCache.clear(); storage.clear();
  pool = new Pool({ host: "127.0.0.1", port: Number(Deno.env.get("TEST_PG_PORT") ?? 5499), user: "postgres", database, max: 4 });
  pool.on("connect", (c: { query: (q: string) => Promise<unknown> }) => { c.query("select set_config('request.jwt.claim.role','service_role',false)"); });
}
export async function closeDatabase(): Promise<void> { if (pool) await pool.end(); pool = null; }
export async function sql(text: string, params: unknown[] = []) { return await pool!.query(text, params); }

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
type Err = { message: string; code?: string; details?: string; hint?: string };
const toErr = (e: any): Err => ({ message: e.message, code: e.code, details: e.detail, hint: e.hint });

async function columns(table: string): Promise<Map<string, string>> {
  if (!colCache.has(table)) {
    const r = await pool!.query("select column_name, data_type from information_schema.columns where table_schema='public' and table_name=$1", [table]);
    colCache.set(table, new Map(r.rows.map((x: any) => [x.column_name, x.data_type])));
  }
  return colCache.get(table)!;
}

type Filter = [string, string, unknown];
class Query implements PromiseLike<any> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private cols = "*"; private filters: Filter[] = []; private payload: any; private orders: string[] = [];
  private lim: number | null = null; private one: "single" | "maybe" | null = null; private ret = false;
  private head = false; private count = false;
  constructor(private table: string) {}
  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") { this.cols = cols; this.head = !!opts?.head; this.count = !!opts?.count; } else { this.ret = true; this.cols = cols; }
    return this;
  }
  insert(p: any) { this.op = "insert"; this.payload = p; return this; }
  update(p: any) { this.op = "update"; this.payload = p; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { this.filters.push([c, "=", v]); return this; }
  neq(c: string, v: unknown) { this.filters.push([c, "<>", v]); return this; }
  gt(c: string, v: unknown) { this.filters.push([c, ">", v]); return this; }
  gte(c: string, v: unknown) { this.filters.push([c, ">=", v]); return this; }
  lt(c: string, v: unknown) { this.filters.push([c, "<", v]); return this; }
  lte(c: string, v: unknown) { this.filters.push([c, "<=", v]); return this; }
  in(c: string, v: unknown[]) { this.filters.push([c, "in", v]); return this; }
  is(c: string, v: unknown) { this.filters.push([c, "is", v]); return this; }
  ilike(c: string, v: string) { this.filters.push([c, "ilike", v]); return this; }
  not(c: string, op: string, v: unknown) { this.filters.push([c, `not ${op}`, v]); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.orders.push(`${q(c)} ${o?.ascending === false ? "desc" : "asc"}`); return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  then(res: any, rej: any) { return this.run().then(res, rej); }

  private where(params: unknown[]): string {
    if (!this.filters.length) return "";
    return " where " + this.filters.map(([c, op, v]) => {
      const col = q(c);
      if (op === "in") { params.push(v); return `${col} = any($${params.length})`; }
      if (op === "is") return v === null ? `${col} is null` : `${col} is ${v ? "true" : "false"}`;
      if (op.startsWith("not ")) {
        const inner = op.slice(4);
        if (inner === "is") return v === null ? `${col} is not null` : `${col} is not ${v ? "true" : "false"}`;
        params.push(v); return `${col} ${inner === "eq" ? "<>" : inner} $${params.length}`;
      }
      params.push(v); return `${col} ${op} $${params.length}`;
    }).join(" and ");
  }

  private async run(): Promise<any> {
    try {
      if (this.cols.includes("(")) throw new Error(`Fake supabase : ressources imbriquées non prises en charge (${this.cols})`);
      const types = await columns(this.table), params: unknown[] = [];
      const val = (c: string, v: unknown) => {
        if (v !== null && typeof v === "object" && types.get(c) === "jsonb") { params.push(JSON.stringify(v)); return `$${params.length}::jsonb`; }
        if (v !== null && typeof v === "object" && types.get(c) === "json") { params.push(JSON.stringify(v)); return `$${params.length}::json`; }
        params.push(v); return `$${params.length}`;
      };
      let text = "";
      const t = `public.${q(this.table)}`;
      const cols = this.cols === "*" ? "*" : this.cols.split(",").map((c) => q(c.trim())).join(", ");
      if (this.op === "select") {
        text = this.count && this.head ? `select count(*)::int as n from ${t}` : `select ${cols} from ${t}`;
        text += this.where(params);
        if (!this.head) { if (this.orders.length) text += ` order by ${this.orders.join(", ")}`; if (this.lim !== null) text += ` limit ${this.lim}`; }
      } else if (this.op === "insert") {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
        const keys = [...new Set(rows.flatMap((r: any) => Object.keys(r).filter((k) => r[k] !== undefined)))];
        text = `insert into ${t} (${keys.map(q).join(", ")}) values ` +
          rows.map((r: any) => `(${keys.map((k) => (r[k] === undefined ? "default" : val(k, r[k]))).join(", ")})`).join(", ");
        if (this.ret) text += ` returning ${cols}`;
      } else if (this.op === "update") {
        const keys = Object.keys(this.payload).filter((k) => this.payload[k] !== undefined);
        text = `update ${t} set ${keys.map((k) => `${q(k)} = ${val(k, this.payload[k])}`).join(", ")}` + this.where(params);
        if (this.ret) text += ` returning ${cols}`;
      } else {
        text = `delete from ${t}` + this.where(params);
        if (this.ret) text += ` returning ${cols}`;
      }
      const r = await pool!.query(text, params);
      if (this.op === "select" && this.count && this.head) return { data: null, error: null, count: r.rows[0].n };
      if (this.op !== "select" && !this.ret) return { data: null, error: null, count: null };
      if (this.one === "single") {
        return r.rows.length === 1 ? { data: r.rows[0], error: null } : { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
      }
      if (this.one === "maybe") {
        return r.rows.length <= 1 ? { data: r.rows[0] ?? null, error: null } : { data: null, error: { code: "PGRST116", message: "multiple rows" } };
      }
      return { data: r.rows, error: null, count: this.count ? r.rows.length : null };
    } catch (e) {
      return { data: null, error: toErr(e) };
    }
  }
}

async function rpc(name: string, args: Record<string, unknown> = {}) {
  try {
    if (!fnCache.has(name)) {
      const r = await pool!.query("select p.proretset, t.typtype from pg_proc p join pg_type t on t.oid = p.prorettype where p.proname = $1 and p.pronamespace = 'public'::regnamespace", [name]);
      if (!r.rows.length) throw Object.assign(new Error(`Fonction inconnue : ${name}`), { code: "PGRST202" });
      fnCache.set(name, { set: r.rows[0].proretset, composite: r.rows[0].typtype === "c" });
    }
    const meta = fnCache.get(name)!;
    const keys = Object.keys(args), params = keys.map((k) => args[k]);
    const r = await pool!.query(`select * from public.${q(name)}(${keys.map((k, i) => `${q(k)} => $${i + 1}`).join(", ")})`, params);
    if (!meta.set) return { data: r.rows[0]?.[name] ?? null, error: null };
    if (meta.composite || r.fields.length > 1) return { data: r.rows, error: null };
    return { data: r.rows.map((x: any) => x[name]), error: null };
  } catch (e) {
    return { data: null, error: toErr(e) };
  }
}

export function createClient(_url: string, _key: string, _opts?: unknown) {
  return {
    from: (table: string) => new Query(table),
    rpc,
    auth: { getUser: (_t: string) => Promise.resolve({ data: { user: null }, error: { message: "non pris en charge dans les tests" } }) },
    storage: { from: (_bucket: string) => ({
      upload: (path: string, data: Uint8Array) => { storage.set(path, data); return Promise.resolve({ data: { path }, error: null }); },
      download: (path: string) => storage.has(path)
        ? Promise.resolve({ data: new Blob([storage.get(path)!]), error: null })
        : Promise.resolve({ data: null, error: { message: "introuvable" } }),
    }) },
  };
}
export type SupabaseClient = ReturnType<typeof createClient>;
