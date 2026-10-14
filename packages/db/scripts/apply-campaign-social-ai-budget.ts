import { readFile } from "node:fs/promises";
import postgres from "postgres";
const url=process.env.DATABASE_URL;if(!url)throw new Error("DATABASE_URL required");
const sql=postgres(url,{max:1});
try{const body=await readFile(new URL("../../../supabase/migrations/20261014023156_campaign_social_ai_budget.sql",import.meta.url),"utf8");await sql.unsafe(body);}finally{await sql.end();}
