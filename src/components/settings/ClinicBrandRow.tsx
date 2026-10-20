import { useEffect, useRef, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { CLINIC_BRAND_KEY, useClinicBrand } from "@/hooks/useClinicBrand";
import { saveClinicBrand } from "@/lib/api/clinicBrand";
import { brandInitials, normalizeHexColor, validateLogoFile } from "@/lib/domain/clinicBrand";

/**
 * Identidade da clínica (só ADMIN): logo e cor aparecem no topo do sistema, no app do paciente e nos
 * relatórios; a Vertexa fica como assinatura secundária. A barreira real é o servidor (RLS + bucket).
 */
export function ClinicBrandRow() {
  const qc = useQueryClient();
  const brand = useClinicBrand();
  const b = brand.data;
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [colorText, setColorText] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setColorText(b?.color ?? "");
  }, [b?.color]);
  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!b) return <span className="text-sm text-muted-foreground">{brand.isLoading ? "Carregando…" : "—"}</span>;

  const colorOk = colorText.trim() === "" || normalizeHexColor(colorText) !== null;
  const shownLogo = preview ?? (removeLogo ? null : b.logoUrl);
  const color = normalizeHexColor(colorText);
  const dirty = Boolean(file) || removeLogo || (color ?? null) !== (b.color ?? null);

  async function save() {
    setMsg(null);
    if (!b) return;
    if (!colorOk) return setMsg({ ok: false, text: "Cor inválida. Use o formato #RRGGBB." });
    setSaving(true);
    try {
      await saveClinicBrand({ clinicId: b.clinicId, currentLogoPath: b.logoPath, newLogo: file, removeLogo, color });
      await qc.invalidateQueries({ queryKey: CLINIC_BRAND_KEY });
      setFile(null);
      setRemoveLogo(false);
      if (fileRef.current) fileRef.current.value = "";
      setMsg({ ok: true, text: "Identidade da clínica salva." });
    } catch {
      setMsg({ ok: false, text: "Não foi possível salvar. Verifique a imagem e tente de novo." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-3 sm:items-end">
      <div className="flex items-center gap-3">
        {shownLogo ? (
          <img src={shownLogo} alt={`Logo de ${b.name}`} className="h-14 w-14 rounded-lg border bg-white object-contain" />
        ) : (
          <span
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground"
            style={color ? { backgroundColor: color } : undefined}
          >
            {brandInitials(b.name)}
          </span>
        )}
        <div className="flex flex-col gap-1.5">
          <input
            ref={fileRef}
            id="clinic-logo-file"
            aria-label="Logo da clínica"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={saving}
            className="block w-full max-w-[15rem] text-xs file:mr-2 file:rounded-md file:border file:border-input file:bg-background file:px-2.5 file:py-1 file:text-xs"
            onChange={(e) => {
              setMsg(null);
              const f = e.target.files?.[0] ?? null;
              if (!f) return setFile(null);
              const err = validateLogoFile(f);
              if (err) {
                setFile(null);
                if (fileRef.current) fileRef.current.value = "";
                return setMsg({ ok: false, text: err });
              }
              setRemoveLogo(false);
              setFile(f);
            }}
          />
          <p className="text-[11px] text-muted-foreground">PNG, JPG ou WebP, até 2 MB. Fundo transparente fica melhor.</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="clinic-color" className="text-xs text-muted-foreground">Cor da marca</label>
        <input
          type="color"
          aria-label="Escolher cor"
          value={color ?? "#F97316"}
          onChange={(e) => setColorText(e.target.value.toUpperCase())}
          className="h-8 w-9 cursor-pointer rounded border bg-background p-0.5"
          disabled={saving}
        />
        <input
          id="clinic-color"
          value={colorText}
          onChange={(e) => setColorText(e.target.value)}
          placeholder="#RRGGBB"
          maxLength={7}
          disabled={saving}
          className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(b.logoPath || file) && !removeLogo ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => {
              setFile(null);
              if (fileRef.current) fileRef.current.value = "";
              if (b.logoPath) setRemoveLogo(true);
            }}
          >
            <Trash2 className="h-4 w-4" /> Remover logo
          </Button>
        ) : null}
        <Button type="button" size="sm" onClick={() => void save()} disabled={saving || !dirty || !colorOk}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {saving ? "Salvando…" : "Salvar identidade"}
        </Button>
      </div>
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-xs text-success" : "text-xs text-destructive"}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
