import { supabase } from "@/lib/supabase";

// Ledger humano de migrations (companion legível da tabela do CLI). A web só LÊ.
export interface MigrationLogRow {
  version: string;
  filename: string;
  description: string;
  session: string | null;
  applied_at: string;
}

/** Lista o ledger de migrations, mais antigas primeiro (ordem de aplicação). */
export async function listMigrationLog(): Promise<MigrationLogRow[]> {
  const { data, error } = await supabase
    .from("schema_migration_log")
    .select("version, filename, description, session, applied_at")
    .order("version", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MigrationLogRow[];
}
