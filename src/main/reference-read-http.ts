import type { Hono } from "hono";
import type {
  CardTargetReadModel,
  ResolveCardTargetInput,
} from "../shared/card-targets";
import type {
  DatabaseViewReadModel,
  ReadDatabaseViewReferenceInput,
} from "../shared/database-views";
import {
  HttpCardTargetParamsSchema,
  HttpDatabaseViewReferenceParamsSchema,
  HttpDatabaseViewReferenceQuerySchema,
} from "../shared/schemas/http";

export interface ReferenceReadHttpDependencies {
  readonly resolveCardTarget: (
    input: ResolveCardTargetInput,
  ) => CardTargetReadModel | null | Promise<CardTargetReadModel | null>;
  readonly readDatabaseViewReference: (
    input: ReadDatabaseViewReferenceInput,
  ) => DatabaseViewReadModel | null | Promise<DatabaseViewReadModel | null>;
}

export const registerReferenceReadHttpRoutes = (
  app: Hono,
  dependencies: ReferenceReadHttpDependencies,
): void => {
  app.get(
    "/api/projects/:projectId/card-targets/:targetBlockId",
    async (context) => {
      const parsed = HttpCardTargetParamsSchema.safeParse(context.req.param());
      if (!parsed.success) {
        return context.json({ error: "Invalid Card target request" }, 400);
      }
      const result = await dependencies.resolveCardTarget({
        requestingProjectId: parsed.data.projectId,
        targetBlockId: parsed.data.targetBlockId,
      });
      if (!result) return context.json({ error: "Project not found" }, 404);
      context.header("Cache-Control", "no-store");
      return context.json(result);
    },
  );

  app.get(
    "/api/projects/:projectId/references/database-views/:databaseViewId",
    async (context) => {
      const parsed = HttpDatabaseViewReferenceParamsSchema.safeParse(
        context.req.param(),
      );
      const query = HttpDatabaseViewReferenceQuerySchema.safeParse(
        context.req.query(),
      );
      if (!parsed.success || !query.success) {
        return context.json({ error: "Invalid Database View reference request" }, 400);
      }
      const result = await dependencies.readDatabaseViewReference({
        requestingProjectId: parsed.data.projectId,
        databaseViewId: parsed.data.databaseViewId,
        ...(query.data.hostBlockId
          ? { hostBlockId: query.data.hostBlockId }
          : {}),
      });
      if (!result) return context.json({ error: "Database View not found" }, 404);
      context.header("Cache-Control", "no-store");
      return context.json(result);
    },
  );
};
