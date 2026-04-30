// Hand-written DB types. Mirrors supabase/migrations/*.sql.
// TODO: replace with `supabase gen types typescript --linked > lib/db/types.ts`
// when we adopt the Supabase CLI. Until then, any schema change requires
// updating this file by hand — keep them in lockstep.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AgentName = "scout" | "theme" | "writer" | "editor" | "eval";

export type DigestStatus =
  | "pending"
  | "scraping"
  | "filtering"
  | "theming"
  | "writing"
  | "editing"
  | "evaluating"
  | "complete"
  | "failed";

export type CitationRole = "primary" | "supporting";

export type EvalDimension =
  | "signal_vs_noise"
  | "voice"
  | "brevity"
  | "citation_honesty"
  | "coverage";

export type Database = {
  public: {
    Tables: {
      digests: {
        Row: {
          date: string;
          status: DigestStatus;
          started_at: string | null;
          completed_at: string | null;
          total_input_tokens: number;
          total_output_tokens: number;
          total_cost_cents: number;
          eval_score_overall: number | null;
          error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          date: string;
          status?: DigestStatus;
          started_at?: string | null;
          completed_at?: string | null;
          total_input_tokens?: number;
          total_output_tokens?: number;
          total_cost_cents?: number;
          eval_score_overall?: number | null;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          date?: string;
          status?: DigestStatus;
          started_at?: string | null;
          completed_at?: string | null;
          total_input_tokens?: number;
          total_output_tokens?: number;
          total_cost_cents?: number;
          eval_score_overall?: number | null;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      themes: {
        Row: {
          id: string;
          digest_date: string;
          position: number;
          title: string;
          summary: string;
          writer_draft: string | null;
          editor_final: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          digest_date: string;
          position: number;
          title: string;
          summary: string;
          writer_draft?: string | null;
          editor_final?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          digest_date?: string;
          position?: number;
          title?: string;
          summary?: string;
          writer_draft?: string | null;
          editor_final?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      agent_runs: {
        Row: {
          id: string;
          digest_date: string;
          theme_id: string | null;
          agent: AgentName;
          model: string;
          system_prompt: string;
          input_json: Json;
          output_json: Json | null;
          output_text: string | null;
          input_tokens: number;
          output_tokens: number;
          cache_read_tokens: number;
          cache_creation_tokens: number;
          cost_cents: number;
          started_at: string;
          completed_at: string | null;
          error: string | null;
        };
        Insert: {
          id?: string;
          digest_date: string;
          theme_id?: string | null;
          agent: AgentName;
          model: string;
          system_prompt: string;
          input_json: Json;
          output_json?: Json | null;
          output_text?: string | null;
          input_tokens?: number;
          output_tokens?: number;
          cache_read_tokens?: number;
          cache_creation_tokens?: number;
          cost_cents?: number;
          started_at?: string;
          completed_at?: string | null;
          error?: string | null;
        };
        Update: {
          id?: string;
          digest_date?: string;
          theme_id?: string | null;
          agent?: AgentName;
          model?: string;
          system_prompt?: string;
          input_json?: Json;
          output_json?: Json | null;
          output_text?: string | null;
          input_tokens?: number;
          output_tokens?: number;
          cache_read_tokens?: number;
          cache_creation_tokens?: number;
          cost_cents?: number;
          started_at?: string;
          completed_at?: string | null;
          error?: string | null;
        };
        Relationships: [];
      };
      tweets: {
        Row: {
          id: string;
          digest_date: string;
          x_tweet_id: string;
          author_handle: string;
          author_name: string | null;
          text: string;
          posted_at: string;
          url: string;
          raw_json: Json;
          scraped_at: string;
          kept: boolean | null;
          scout_reason: string | null;
          scout_score: number | null;
          scout_model: string | null;
          scout_run_id: string | null;
        };
        Insert: {
          id?: string;
          digest_date: string;
          x_tweet_id: string;
          author_handle: string;
          author_name?: string | null;
          text: string;
          posted_at: string;
          url: string;
          raw_json: Json;
          scraped_at?: string;
          kept?: boolean | null;
          scout_reason?: string | null;
          scout_score?: number | null;
          scout_model?: string | null;
          scout_run_id?: string | null;
        };
        Update: {
          id?: string;
          digest_date?: string;
          x_tweet_id?: string;
          author_handle?: string;
          author_name?: string | null;
          text?: string;
          posted_at?: string;
          url?: string;
          raw_json?: Json;
          scraped_at?: string;
          kept?: boolean | null;
          scout_reason?: string | null;
          scout_score?: number | null;
          scout_model?: string | null;
          scout_run_id?: string | null;
        };
        Relationships: [];
      };
      theme_citations: {
        Row: {
          id: string;
          theme_id: string;
          tweet_id: string;
          position: number;
          role: CitationRole;
        };
        Insert: {
          id?: string;
          theme_id: string;
          tweet_id: string;
          position: number;
          role?: CitationRole;
        };
        Update: {
          id?: string;
          theme_id?: string;
          tweet_id?: string;
          position?: number;
          role?: CitationRole;
        };
        Relationships: [];
      };
      eval_scores: {
        Row: {
          id: string;
          digest_date: string;
          dimension: EvalDimension;
          score: number;
          feedback: string | null;
          run_index: number;
          agent_run_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          digest_date: string;
          dimension: EvalDimension;
          score: number;
          feedback?: string | null;
          run_index?: number;
          agent_run_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          digest_date?: string;
          dimension?: EvalDimension;
          score?: number;
          feedback?: string | null;
          run_index?: number;
          agent_run_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
