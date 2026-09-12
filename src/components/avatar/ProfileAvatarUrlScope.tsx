/* Context + provider no mesmo arquivo de propósito: um único scope de lista. */
/* eslint-disable react-refresh/only-export-components */
import { createContext, type ReactNode } from "react";

import { useProfileAvatarUrls } from "@/hooks/useProfileAvatar";

export const ProfileAvatarUrlContext = createContext<Map<string, string> | null>(null);
const EMPTY_AVATAR_URLS = new Map<string, string>();

export function ProfileAvatarUrlScope({
  paths,
  children,
}: {
  paths: Array<string | null | undefined>;
  children: ReactNode;
}) {
  const query = useProfileAvatarUrls(paths);
  return (
    <ProfileAvatarUrlContext.Provider value={query.data ?? EMPTY_AVATAR_URLS}>
      {children}
    </ProfileAvatarUrlContext.Provider>
  );
}
