import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useMarkOnboardingTutorialSeen,
  useMyOnboardingTutorial,
} from "@/hooks/useOnboardingTutorial";
import type { TutorialAudience } from "@/lib/api/onboardingTutorials";
import { TutorialContext, type TutorialControls } from "./tutorialContext";

/**
 * Tutorial em vídeo do primeiro acesso (cartão 1087). Abre sozinho uma vez, quando o
 * admin da plataforma publicou o vídeo e o usuário ainda não o viu; ao fechar, marca
 * como visto. Depois, o menu da conta reabre pelo `open()` do contexto.
 */
export function OnboardingTutorialProvider({
  audience,
  children,
}: {
  audience: TutorialAudience;
  children: ReactNode;
}) {
  const tutorial = useMyOnboardingTutorial(audience);
  const markSeen = useMarkOnboardingTutorialSeen(audience);
  const [isOpen, setIsOpen] = useState(false);
  const autoOpened = useRef(false);
  const data = tutorial.data ?? null;

  useEffect(() => {
    if (data?.pending && !autoOpened.current) {
      autoOpened.current = true;
      setIsOpen(true);
    }
  }, [data?.pending]);

  const close = useCallback(() => {
    setIsOpen(false);
    if (data?.pending && !markSeen.isPending) markSeen.mutate();
  }, [data?.pending, markSeen]);

  const controls = useMemo<TutorialControls>(
    () => ({ available: Boolean(data), open: () => setIsOpen(true) }),
    [data],
  );

  return (
    <TutorialContext.Provider value={controls}>
      {children}
      {data ? (
        <Dialog
          open={isOpen}
          onOpenChange={(next) => (next ? setIsOpen(true) : close())}
        >
          <DialogContent
            className="max-w-3xl"
            data-testid="onboarding-tutorial"
          >
            <DialogHeader>
              <DialogTitle>{data.title || "Bem-vindo à Vertexa"}</DialogTitle>
              <DialogDescription>
                Um vídeo curto para você começar a usar sozinho. Para rever
                depois, abra o menu da sua conta e toque em “Tutorial do app”.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="px-0 py-0 sm:px-6 sm:py-4">
              <video
                key={data.videoUrl}
                src={data.videoUrl}
                controls
                playsInline
                preload="metadata"
                className="aspect-video max-h-[60vh] w-full bg-black sm:rounded-md"
                aria-label="Vídeo do tutorial"
              />
            </DialogBody>
            <DialogFooter>
              <Button onClick={close}>Começar a usar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </TutorialContext.Provider>
  );
}
