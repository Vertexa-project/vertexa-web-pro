import { supabase } from "@/lib/supabase";

/** Público do tutorial: `clinic` = painel web da clínica; `patient` = app do paciente. */
export type TutorialAudience = "clinic" | "patient";

export const TUTORIAL_BUCKET = "onboarding-tutorials";
export const TUTORIAL_MAX_BYTES = 50 * 1024 * 1024;
export const TUTORIAL_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
];

export const TUTORIAL_AUDIENCE_LABEL: Record<TutorialAudience, string> = {
  clinic: "Clínica (painel web)",
  patient: "Paciente (app do paciente)",
};

export interface MyOnboardingTutorial {
  title: string;
  videoUrl: string;
  /** true quando o usuário ainda não viu este tutorial (primeiro acesso). */
  pending: boolean;
}

export interface PlatformOnboardingTutorial {
  audience: TutorialAudience;
  title: string;
  videoPath: string | null;
  videoUrl: string | null;
  isActive: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
}

export function tutorialVideoUrl(path: string): string {
  return supabase.storage.from(TUTORIAL_BUCKET).getPublicUrl(path).data
    .publicUrl;
}

interface MyTutorialRow {
  title: string | null;
  video_path: string | null;
  pending: boolean | null;
}

export async function getMyOnboardingTutorial(
  audience: TutorialAudience,
): Promise<MyOnboardingTutorial | null> {
  const { data, error } = await supabase.rpc("get_my_onboarding_tutorial", {
    p_audience: audience,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as
    MyTutorialRow | undefined;
  if (!row?.video_path) return null;
  return {
    title: row.title ?? "",
    videoUrl: tutorialVideoUrl(row.video_path),
    pending: row.pending === true,
  };
}

export async function markOnboardingTutorialSeen(
  audience: TutorialAudience,
): Promise<void> {
  const { error } = await supabase.rpc("mark_onboarding_tutorial_seen", {
    p_audience: audience,
  });
  if (error) throw error;
}

interface PlatformTutorialRow {
  audience: string;
  title: string | null;
  video_path: string | null;
  is_active: boolean | null;
  updated_at: string | null;
  updated_by_name: string | null;
}

export async function listPlatformOnboardingTutorials(): Promise<
  PlatformOnboardingTutorial[]
> {
  const { data, error } = await supabase.rpc(
    "platform_list_onboarding_tutorials",
  );
  if (error) throw error;
  return ((data ?? []) as PlatformTutorialRow[])
    .filter(
      (r): r is PlatformTutorialRow & { audience: TutorialAudience } =>
        r.audience === "clinic" || r.audience === "patient",
    )
    .map((r) => ({
      audience: r.audience,
      title: r.title ?? "",
      videoPath: r.video_path,
      videoUrl: r.video_path ? tutorialVideoUrl(r.video_path) : null,
      isActive: r.is_active === true,
      updatedAt: r.updated_at,
      updatedByName: r.updated_by_name,
    }));
}

export interface SaveOnboardingTutorialInput {
  audience: TutorialAudience;
  title: string;
  videoPath: string | null;
  isActive: boolean;
}

export async function savePlatformOnboardingTutorial(
  input: SaveOnboardingTutorialInput,
): Promise<void> {
  const { error } = await supabase.rpc("platform_set_onboarding_tutorial", {
    p_audience: input.audience,
    p_title: input.title,
    p_video_path: input.videoPath ?? "",
    p_is_active: input.isActive,
  });
  if (error) throw error;
}

/** Valida o arquivo antes do envio; devolve a mensagem de erro ou null. */
export function tutorialFileError(
  file: Pick<File, "size" | "type">,
): string | null {
  if (!TUTORIAL_MIME_TYPES.includes(file.type))
    return "Envie um vídeo MP4, WebM ou MOV.";
  if (file.size > TUTORIAL_MAX_BYTES)
    return "O vídeo passa de 50 MB. Exporte em tamanho menor.";
  return null;
}

export async function uploadOnboardingTutorialVideo(
  audience: TutorialAudience,
  file: File,
): Promise<string> {
  const problem = tutorialFileError(file);
  if (problem) throw new Error(problem);
  const ext =
    (file.name.split(".").pop() ?? "mp4")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "mp4";
  // Caminho novo a cada envio: o bucket é público com cache, então não sobrescrevemos.
  const path = `${audience}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from(TUTORIAL_BUCKET)
    .upload(path, file, {
      contentType: file.type,
      upsert: false,
      cacheControl: "31536000",
    });
  if (error) throw error;
  return path;
}
