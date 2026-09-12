import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { getAvatarSignedUrl, getAvatarSignedUrls, getProfileAvatarFields } from "@/lib/api/avatar";
import {
  AVATAR_SIGNED_URL_GC_MS,
  AVATAR_SIGNED_URL_REFETCH_MS,
  AVATAR_SIGNED_URL_STALE_MS,
} from "@/lib/avatar/constants";
import { uniqueAvatarPaths } from "@/lib/avatar/signedUrlBatch";
import { qk } from "@/lib/queryKeys";

export function useMyProfileAvatar(profileId: string | null | undefined) {
  return useQuery({
    queryKey: qk.myProfileAvatar(profileId ?? "none"),
    queryFn: () => getProfileAvatarFields(profileId as string),
    enabled: Boolean(profileId),
    staleTime: 30_000,
  });
}

export function useSignedAvatarUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: qk.avatarSignedUrl(path ?? "none"),
    queryFn: () => getAvatarSignedUrl(path as string),
    enabled: Boolean(path),
    staleTime: AVATAR_SIGNED_URL_STALE_MS,
    gcTime: AVATAR_SIGNED_URL_GC_MS,
    refetchInterval: AVATAR_SIGNED_URL_REFETCH_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
  });
}

export function useProfileAvatarUrls(paths: Array<string | null | undefined>) {
  const unique = useMemo(() => uniqueAvatarPaths(paths), [paths]);
  const fingerprint = unique.join("\0");
  return useQuery({
    queryKey: qk.avatarSignedUrlBatch(fingerprint),
    queryFn: () => getAvatarSignedUrls(unique),
    enabled: unique.length > 0,
    staleTime: AVATAR_SIGNED_URL_STALE_MS,
    gcTime: AVATAR_SIGNED_URL_GC_MS,
    refetchInterval: unique.length > 0 ? AVATAR_SIGNED_URL_REFETCH_MS : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
  });
}
