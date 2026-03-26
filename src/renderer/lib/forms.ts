import type { FormEvent } from "react";
import type { z } from "zod";

export function handleFormSubmit(
  event: FormEvent<HTMLFormElement>,
  submit: () => void | Promise<void>,
): void {
  event.preventDefault();
  event.stopPropagation();
  void submit();
}

export function resolveFormErrorMessage(error: unknown): string | null {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return null;
}

export function resolveZodErrorMessage(error: z.ZodError | null | undefined): string | null {
  if (!error) return null;

  for (const issue of error.issues) {
    if (typeof issue.message === "string" && issue.message.trim()) {
      return issue.message;
    }
  }

  return null;
}
