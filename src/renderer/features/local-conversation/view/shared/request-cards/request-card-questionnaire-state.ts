import type { CodexProtocolRequestId, CodexUserInputRequest } from "../../../../../lib/types";

type CodexUserInputQuestion = CodexUserInputRequest["questions"][number];

export type RequestComposerQuestion = CodexUserInputQuestion & {
  otherPlaceholder?: string;
};

export interface RequestComposerRequest {
  requestId: CodexProtocolRequestId;
  questions: RequestComposerQuestion[];
}

export interface RequestQuestionnaireAnswer {
  selectedOptionId: string | null;
  freeformText: string | null;
}

export interface RequestQuestionnaireDraft {
  answers: RequestQuestionnaireAnswer[];
  questionIndex: number;
}

export type RequestChoiceBehavior =
  | {
      kind: "advanceOnActivation";
      acknowledgementMs: number;
    }
  | {
      kind: "selectOnly";
    };

export interface RequestQuestionnairePolicy {
  choiceBehavior: RequestChoiceBehavior;
  presentation: "composer" | "form";
  requireAllAnswers: boolean;
}

export const REQUEST_INPUT_COMPOSER_POLICY: RequestQuestionnairePolicy = {
  choiceBehavior: {
    kind: "advanceOnActivation",
    acknowledgementMs: 180,
  },
  presentation: "composer",
  requireAllAnswers: false,
};

export const SETUP_TASK_FORM_POLICY: RequestQuestionnairePolicy = {
  choiceBehavior: {
    kind: "advanceOnActivation",
    acknowledgementMs: 0,
  },
  presentation: "form",
  requireAllAnswers: false,
};

export const EXPLICIT_REQUEST_FORM_POLICY: RequestQuestionnairePolicy = {
  choiceBehavior: {
    kind: "selectOnly",
  },
  presentation: "form",
  requireAllAnswers: true,
};

function createInitialAnswer(question: RequestComposerQuestion): RequestQuestionnaireAnswer {
  return {
    selectedOptionId: question.options?.[0]?.label ?? null,
    freeformText: null,
  };
}

export function createInitialRequestQuestionnaireDraft(
  request: RequestComposerRequest,
): RequestQuestionnaireDraft {
  return {
    answers: request.questions.map(createInitialAnswer),
    questionIndex: 0,
  };
}

export function buildRequestQuestionSignature(request: RequestComposerRequest): string {
  return JSON.stringify(
    request.questions.map((question) => ({
      id: question.id,
      options: question.options?.map((option) => option.label) ?? [],
      isOther: question.isOther,
      isSecret: question.isSecret,
    })),
  );
}

export function reconcileRequestQuestionnaireDraft(
  request: RequestComposerRequest,
  draft: RequestQuestionnaireDraft | null | undefined,
): RequestQuestionnaireDraft {
  if (!draft || draft.answers.length !== request.questions.length) {
    return createInitialRequestQuestionnaireDraft(request);
  }

  const answers = request.questions.map((question, index) => {
    const saved = draft.answers[index];
    if (!saved) return createInitialAnswer(question);

    const selectedOptionId = question.options?.some(
      (option) => option.label === saved.selectedOptionId,
    )
      ? saved.selectedOptionId
      : null;
    const freeformText = typeof saved.freeformText === "string" ? saved.freeformText : null;

    if (!question.options?.length) {
      return {
        selectedOptionId: null,
        freeformText,
      };
    }

    if (saved.selectedOptionId === null) {
      return {
        selectedOptionId: null,
        freeformText,
      };
    }

    if (selectedOptionId !== null) {
      return {
        selectedOptionId,
        freeformText,
      };
    }

    if (question.isOther && freeformText !== null) {
      return {
        selectedOptionId: null,
        freeformText,
      };
    }

    return createInitialAnswer(question);
  });

  return {
    answers,
    questionIndex: Math.max(0, Math.min(request.questions.length - 1, draft.questionIndex)),
  };
}

function updateAnswer(
  draft: RequestQuestionnaireDraft,
  questionIndex: number,
  update: (answer: RequestQuestionnaireAnswer) => RequestQuestionnaireAnswer,
): RequestQuestionnaireDraft {
  const answer = draft.answers[questionIndex];
  if (!answer) return draft;

  return {
    ...draft,
    answers: draft.answers.map((candidate, index) =>
      index === questionIndex ? update(candidate) : candidate,
    ),
  };
}

export function selectRequestQuestionnaireOption(
  draft: RequestQuestionnaireDraft,
  questionIndex: number,
  optionId: string,
): RequestQuestionnaireDraft {
  return updateAnswer(draft, questionIndex, (answer) => ({
    ...answer,
    selectedOptionId: optionId,
  }));
}

export function setRequestQuestionnaireFreeform(
  draft: RequestQuestionnaireDraft,
  questionIndex: number,
  value: string,
): RequestQuestionnaireDraft {
  return updateAnswer(draft, questionIndex, () => ({
    selectedOptionId: null,
    freeformText: value,
  }));
}

export function activateRequestQuestionnaireOther(
  draft: RequestQuestionnaireDraft,
  questionIndex: number,
): RequestQuestionnaireDraft {
  return updateAnswer(draft, questionIndex, (answer) => ({
    ...answer,
    selectedOptionId: null,
    freeformText: answer.freeformText ?? "",
  }));
}

export function clearCurrentRequestQuestionnaireAnswer(
  draft: RequestQuestionnaireDraft,
): RequestQuestionnaireDraft {
  return updateAnswer(draft, draft.questionIndex, () => ({
    selectedOptionId: null,
    freeformText: null,
  }));
}

export function navigateRequestQuestionnaire(
  request: RequestComposerRequest,
  draft: RequestQuestionnaireDraft,
  questionIndex: number,
): RequestQuestionnaireDraft {
  return {
    ...draft,
    questionIndex: Math.max(0, Math.min(request.questions.length - 1, questionIndex)),
  };
}

export function getRequestQuestionnaireAnswer(
  request: RequestComposerRequest,
  draft: RequestQuestionnaireDraft,
  questionId: string,
): RequestQuestionnaireAnswer | null {
  const questionIndex = request.questions.findIndex((question) => question.id === questionId);
  if (questionIndex < 0) return null;
  return draft.answers[questionIndex] ?? null;
}

export function resolveRequestQuestionnaireAnswerValue(
  question: RequestComposerQuestion,
  answer: RequestQuestionnaireAnswer | null | undefined,
): string | null {
  if (!answer) return null;
  if (question.options?.length && answer.selectedOptionId) {
    return answer.selectedOptionId;
  }
  if (question.options?.length && !question.isOther) return null;

  const freeformText = answer.freeformText?.trim() ?? "";
  return freeformText || null;
}

export function buildUserInputAnswers(
  request: RequestComposerRequest,
  draft: RequestQuestionnaireDraft,
): Record<string, string[]> {
  return request.questions.reduce<Record<string, string[]>>((answers, question, index) => {
    const value = resolveRequestQuestionnaireAnswerValue(question, draft.answers[index]);
    if (!value) return answers;

    answers[question.id] = [value];
    return answers;
  }, {});
}

export function isRequestQuestionnaireSubmittable(
  request: RequestComposerRequest,
  draft: RequestQuestionnaireDraft,
  policy: RequestQuestionnairePolicy,
): boolean {
  if (!policy.requireAllAnswers) return true;

  return request.questions.every(
    (question, index) =>
      resolveRequestQuestionnaireAnswerValue(question, draft.answers[index]) !== null,
  );
}

export function isLastRequestQuestion(
  request: RequestComposerRequest,
  draft: RequestQuestionnaireDraft,
): boolean {
  return draft.questionIndex >= request.questions.length - 1;
}
