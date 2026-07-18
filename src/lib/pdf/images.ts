/**
 * Converte uma URL de imagem em data URI para embutir no PDF. Desde WP-STORAGE P2 recebe a
 * signed URL do bucket privado progress-photos (fallback: photo_url legado). @react-pdf embute
 * Image por URL, mas geração no client depende de CORS da origem — então pré-buscamos e
 * convertemos a bytes. Falha (CORS/404/expirada) → null → o relatório mostra placeholder, sem
 * quebrar. Já-data-URI passa direto (o seed às vezes usa data URI de placeholder).
 */
export async function urlToDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
