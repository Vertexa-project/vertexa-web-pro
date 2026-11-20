import { createContext, useContext } from "react";

export interface TutorialControls {
  /** true quando há vídeo publicado para este público. */
  available: boolean;
  open: () => void;
}

export const TutorialContext = createContext<TutorialControls>({
  available: false,
  open: () => {},
});

export function useOnboardingTutorialControls(): TutorialControls {
  return useContext(TutorialContext);
}
