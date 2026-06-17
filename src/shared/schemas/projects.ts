import { z } from "zod";
import type {
  ProjectOrderInput,
  ProjectPinnedInput,
  ProjectPinnedOrderInput,
} from "../types";

export const ProjectOrderInputSchema = z.object({
  orderedProjectIds: z.array(z.string()),
}) satisfies z.ZodType<ProjectOrderInput>;

export const ProjectPinnedInputSchema = z.object({
  pinned: z.boolean(),
}) satisfies z.ZodType<ProjectPinnedInput>;

export const ProjectPinnedOrderInputSchema = z.object({
  orderedProjectIds: z.array(z.string()),
}) satisfies z.ZodType<ProjectPinnedOrderInput>;
