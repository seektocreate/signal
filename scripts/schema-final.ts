import { createClient } from "@supabase/supabase-js";
import type { AgentName, Database } from "@/lib/db/types";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
}

const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

async function main() {
  console.log("=== FINAL SCHEMA DETAILS ===\n");

  // Get a non-scout run (theme, writer, editor, eval)
  const agents: AgentName[] = ["theme", "writer", "editor", "eval"];
  
  for (const agent of agents) {
    console.log(`\n--- AGENT_RUNS: ${agent} ---`);
    const { data: runs } = await supabase
      .from("agent_runs")
      .select("*")
      .eq("digest_date", "2026-04-30")
      .eq("agent", agent)
      .limit(1);

    if (runs && runs.length > 0) {
      const r = runs[0];
      console.log(JSON.stringify({
        agent: r.agent,
        theme_id: r.theme_id,
        model: r.model,
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        cost_cents: r.cost_cents,
        cache_read_tokens: r.cache_read_tokens,
        cache_creation_tokens: r.cache_creation_tokens,
        started_at: r.started_at,
        completed_at: r.completed_at,
        error: r.error,
        output_json_keys: r.output_json ? Object.keys(r.output_json) : null,
      }, null, 2));
    }
  }

  // Get full eval_scores with feedback
  console.log("\n--- EVAL_SCORES: all for digest ---");
  const { data: allEvals } = await supabase
    .from("eval_scores")
    .select("*")
    .eq("digest_date", "2026-04-30")
    .order("run_index, dimension");

  if (allEvals && allEvals.length > 0) {
    console.log(`Total rows: ${allEvals.length}`);
    console.log("\nSample (first 3 rows):");
    allEvals.slice(0, 3).forEach((e) => {
      console.log(JSON.stringify({
        id: e.id,
        dimension: e.dimension,
        score: e.score,
        run_index: e.run_index,
        feedback_length: e.feedback ? e.feedback.length : 0,
        feedback_preview: e.feedback ? e.feedback.substring(0, 120) : null,
      }, null, 2));
    });
  }

  // Check if all required agent fields are filled
  console.log("\n--- MISSING/NULL ANALYSIS ---");
  const { data: allRuns } = await supabase
    .from("agent_runs")
    .select("*")
    .eq("digest_date", "2026-04-30");

  if (allRuns) {
    let nullOutput = 0;
    let nullCompleted = 0;
    let nullError = 0;
    
    allRuns.forEach((r) => {
      if (!r.output_json && r.agent !== "eval") nullOutput++;
      if (!r.completed_at) nullCompleted++;
      if (r.error === null) nullError++;
    });

    console.log(`Runs with null output_json (non-eval): ${nullOutput}`);
    console.log(`Runs with null completed_at: ${nullCompleted}`);
    console.log(`Runs with null error (expected): ${nullError}/${allRuns.length}`);
  }
}

main().catch(console.error);
