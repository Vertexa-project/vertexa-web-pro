// Confirmar / descartar uma importação com Conferência. Gravar passa SÓ pelos caminhos que já existem:
//   bioimpedância → createBodyAssessment (body_assessments: a série de peso e o % de gordura leem dali)
//   dieta         → saveNutritionPlan (RPC save_nutrition_plan)    treino → saveWorkoutPlan (RPC save_workout_plan)
// e depois o documento original entra em Documentos. Descartar não grava nada além do rastro.
import { createBodyAssessment, type SaveAssessmentInput } from "@/lib/api/assessments";
import { registerPatientDocument, removeDocumentObject, type RegisterDocumentInput } from "@/lib/api/documents";
import { resolveDocRead } from "@/lib/api/docRead";
import { saveNutritionPlan, saveWorkoutPlan, type SaveNutritionPlanInput, type SaveWorkoutPlanInput } from "@/lib/api/planMutations";
import {
  buildAssessment, buildMeals, buildWorkouts, conferenceStatus, correctedCount, documentTitle, DOC_KIND_SURFACE, IMPORTED_PLAN_TITLE,
  type ConferenceState, type DocKind, type DocReadResult,
} from "@/lib/domain/docImport";
import { WriteForbiddenError } from "@/lib/domain/disciplines";

export class ConferenceBlockedError extends Error {
  constructor() {
    super("Confira os campos em laranja antes de confirmar.");
    this.name = "ConferenceBlockedError";
  }
}
export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportValidationError";
  }
}

export interface ConfirmDeps {
  createAssessment: (input: SaveAssessmentInput) => Promise<unknown>;
  saveNutrition: (input: SaveNutritionPlanInput) => Promise<void>;
  saveWorkout: (input: SaveWorkoutPlanInput) => Promise<void>;
  registerDocument: (input: RegisterDocumentInput) => Promise<{ id: string }>;
  resolve: typeof resolveDocRead;
  removeObject: (path: string) => Promise<void>;
}

export const defaultDeps: ConfirmDeps = {
  createAssessment: createBodyAssessment,
  saveNutrition: saveNutritionPlan,
  saveWorkout: saveWorkoutPlan,
  registerDocument: registerPatientDocument,
  resolve: resolveDocRead,
  removeObject: removeDocumentObject,
};

export interface ConfirmArgs {
  kind: DocKind;
  patientId: string;
  professionalId: string | null;
  /** Disciplina cobre o que o documento vira? (defesa em profundidade; o banco decide de novo). */
  canWrite: boolean;
  readId: string;
  path: string;
  mime: string | null;
  size: number | null;
  result: DocReadResult;
  state: ConferenceState;
  today: string;
}

/** O que já foi feito: permite repetir só o que falhou (nunca gravar o plano duas vezes). */
export interface ConfirmProgress {
  wrote: boolean;
  documentId: string | null;
}
export const freshProgress = (): ConfirmProgress => ({ wrote: false, documentId: null });

export interface ConfirmOutcome {
  documentId: string;
  /** Rastro de quem confirmou, em segundo plano (a tela não espera por ele). false = os dados e o documento foram salvos,
   *  mas o rastro não chegou (avisar sem desfazer). */
  traced: Promise<boolean>;
}

export async function confirmImport(a: ConfirmArgs, progress: ConfirmProgress = freshProgress(), deps: ConfirmDeps = defaultDeps): Promise<ConfirmOutcome> {
  if (!a.canWrite) throw new WriteForbiddenError(DOC_KIND_SURFACE[a.kind]);
  // Portão: nenhum incerto sem conferir e nenhum valor recusado pelas regras.
  if (!conferenceStatus(a.kind, a.result, a.state, a.today).canConfirm) throw new ConferenceBlockedError();

  if (!progress.wrote) {
    if (a.kind === "bioimpedancia") {
      const v = buildAssessment(a.state, a.today);
      if (!v.ok) throw new ImportValidationError(v.error);
      await deps.createAssessment({ ...v.value, patientId: a.patientId, professionalId: a.professionalId });
    } else if (a.kind === "dieta") {
      const meals = buildMeals(a.result, a.state).filter((m) => m.items.length > 0);
      if (meals.length === 0) throw new ImportValidationError("Nenhuma refeição para salvar.");
      await deps.saveNutrition({ patientId: a.patientId, professionalId: a.professionalId, title: IMPORTED_PLAN_TITLE.dieta, meals });
    } else {
      const workouts = buildWorkouts(a.result, a.state).filter((w) => w.exercises.length > 0);
      if (workouts.length === 0) throw new ImportValidationError("Nenhum exercício para salvar.");
      await deps.saveWorkout({ patientId: a.patientId, professionalId: a.professionalId, title: IMPORTED_PLAN_TITLE.treino, goal: null, workouts });
    }
    progress.wrote = true;
  }

  if (!progress.documentId) {
    const doc = await deps.registerDocument({
      patientId: a.patientId,
      path: a.path,
      mime: a.mime,
      size: a.size,
      kind: a.kind === "bioimpedancia" ? "exam" : "report",
      title: documentTitle(a.kind, a.result.mode, a.today),
      uploadedByProfessionalId: a.professionalId,
    });
    progress.documentId = doc.id;
  }

  const traced = deps.resolve(a.readId, "confirmado", { fieldsCorrected: correctedCount(a.result, a.state), documentId: progress.documentId })
    .then(() => true, () => false);
  return { documentId: progress.documentId, traced };
}

/** Descartar: nada vai para a ficha nem para Documentos; só o rastro da decisão. */
export async function discardImport(readId: string, path: string, deps: ConfirmDeps = defaultDeps): Promise<void> {
  try {
    await deps.resolve(readId, "descartado");
  } catch {
    // rastro é best-effort aqui: descartar nunca trava o profissional
  }
  await deps.removeObject(path);
}
