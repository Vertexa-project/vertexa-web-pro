import { useContext } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ProfileAvatarUrlContext } from "@/components/avatar/ProfileAvatarUrlScope";
import { useSignedAvatarUrl } from "@/hooks/useProfileAvatar";
import { avatarInitials } from "@/lib/domain/avatarInitials";
import { cn } from "@/lib/utils";

export function ProfilePhoto({
  name,
  avatarPath,
  legacyUrl,
  signedUrl,
  className,
  alt,
}: {
  name: string | null | undefined;
  avatarPath?: string | null;
  legacyUrl?: string | null;
  /** URL já resolvida pelo batch da superfície. Se presente (ou houver scope), não assina de novo. */
  signedUrl?: string | null;
  className?: string;
  alt?: string;
}) {
  const batch = useContext(ProfileAvatarUrlContext);
  const skipFetch = signedUrl != null || batch instanceof Map;
  const own = useSignedAvatarUrl(skipFetch ? null : avatarPath);
  const resolved =
    signedUrl || (avatarPath ? batch?.get(avatarPath) : undefined) || own.data || undefined;
  const src = resolved || (!avatarPath ? legacyUrl || undefined : undefined);
  const label = alt ?? name ?? "Foto de perfil";
  const letters = avatarInitials(name);

  return (
    <Avatar
      className={cn("bg-muted", className)}
      data-testid="profile-photo"
      data-photo={src ? "signed" : "fallback"}
    >
      {src ? (
        <AvatarImage src={src} alt={label} className="object-cover" draggable={false} />
      ) : null}
      <AvatarFallback aria-hidden className="text-[0.7em] font-semibold tracking-wide">
        {letters}
      </AvatarFallback>
    </Avatar>
  );
}
