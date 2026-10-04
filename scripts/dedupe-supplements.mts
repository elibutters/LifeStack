// Folds duplicate supplement entries: keeps the earliest entry for each supplement on each day and removes the
// rest. Shows what it would remove; nothing is deleted unless you pass --apply.
//   pnpm db:dedupe-supplements            (dry run)
//   pnpm db:dedupe-supplements --apply
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }
const tz = process.env.APP_TZ || "UTC";
const apply = process.argv.includes("--apply");
const sql = postgres(url, { prepare: false, max: 1 });

const dupes = await sql<{ id: string; name: string; day: string; ts: Date }[]>`
  with ranked as (
    select id, value_text as name, ts, (ts at time zone ${tz})::date as day,
           row_number() over (partition by lower(value_text), (ts at time zone ${tz})::date order by ts, id) as rn
    from events where key = 'supplement.taken'
  )
  select id::text, name, day::text, ts from ranked where rn > 1 order by day, name, ts`;

const byGroup = new Map<string, number>();
for (const d of dupes) byGroup.set(`${d.day} ${d.name}`, (byGroup.get(`${d.day} ${d.name}`) ?? 0) + 1);
console.log(`${dupes.length} duplicate supplement entries across ${byGroup.size} supplement-days`);
for (const [k, n] of [...byGroup].slice(0, 40)) console.log(`  ${k}: ${n} extra`);

if (apply && dupes.length) {
  const gone = await sql`delete from events where key = 'supplement.taken' and id = any(${dupes.map((d) => Number(d.id))}) returning id`;
  console.log(`removed ${gone.length}`);
} else if (dupes.length) {
  console.log("dry run: nothing removed. Run again with --apply to remove them.");
}
await sql.end();
