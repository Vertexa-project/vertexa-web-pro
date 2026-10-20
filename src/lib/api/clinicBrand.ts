import { supabase } from "@/lib/supabase";
import { buildLogoPath, CLINIC_LOGOS_BUCKET, fitWithin, LOGO_MAX_SIDE_PX, logoPublicUrl, type ClinicBrand } from "@/lib/domain/clinicBrand";
import { decodeImageFile, releaseDecodedImage } from "@/lib/avatar/processAvatar";
import { randomAvatarVersion } from "@/lib/avatar/path";

interface BrandRow {
  clinic_id: string;
  clinic_name: string | null;
  logo_path: string | null;
  brand_color: string | null;
}

/** Marca da clínica de quem está logado (RPC get_my_clinic_brand). null = sem clínica ativa. */
export async function getMyClinicBrand(): Promise<ClinicBrand | null> {
  const { data, error } = await supabase.rpc("get_my_clinic_brand");
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as BrandRow | null | undefined;
  if (!row?.clinic_id) return null;
  return { clinicId: row.clinic_id, name: row.clinic_name ?? "Clínica", logoPath: row.logo_path, color: row.brand_color };
}

export function clinicLogoUrl(path: string | null | undefined): string | null {
  return logoPublicUrl(import.meta.env.VITE_SUPABASE_URL as string, path);
}

/** Converte a imagem escolhida em PNG (maior lado ≤ 512 px, fundo transparente preservado). */
export async function normalizeLogoToPng(file: File): Promise<Blob> {
  const decoded = await decodeImageFile(file);
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height, LOGO_MAX_SIDE_PX);
    if (!width || !height) throw new Error("logo-decode");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("logo-canvas");
    ctx.drawImage(decoded.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error("logo-encode");
    return blob;
  } finally {
    releaseDecodedImage(decoded);
  }
}

/**
 * Salva a marca: sobe a logo nova (se houver), grava logo_path/brand_color na clínica e só então
 * apaga a logo anterior (best-effort). Se a gravação na clínica falhar, remove o arquivo recém-subido.
 * A barreira real é o servidor: só o ADMIN da clínica grava (RLS + policy do bucket + CHECKs).
 */
export async function saveClinicBrand(input: {
  clinicId: string;
  currentLogoPath: string | null;
  newLogo: File | null;
  removeLogo: boolean;
  color: string | null;
}): Promise<void> {
  let logoPath: string | null = input.removeLogo ? null : input.currentLogoPath;
  let uploaded: string | null = null;

  if (input.newLogo) {
    const png = await normalizeLogoToPng(input.newLogo);
    uploaded = buildLogoPath(input.clinicId, randomAvatarVersion());
    const { error: upErr } = await supabase.storage.from(CLINIC_LOGOS_BUCKET).upload(uploaded, png, {
      contentType: "image/png",
      upsert: false,
      cacheControl: "31536000",
    });
    if (upErr) throw upErr;
    logoPath = uploaded;
  }

  const { data, error } = await supabase
    .from("clinics")
    .update({ logo_path: logoPath, brand_color: input.color })
    .eq("id", input.clinicId)
    .select("id");
  if (error || !data?.length) {
    if (uploaded) await supabase.storage.from(CLINIC_LOGOS_BUCKET).remove([uploaded]);
    if (error) throw error;
    throw new Error("brand-not-saved");
  }

  if (input.currentLogoPath && input.currentLogoPath !== logoPath) {
    await supabase.storage.from(CLINIC_LOGOS_BUCKET).remove([input.currentLogoPath]).catch(() => undefined);
  }
}
