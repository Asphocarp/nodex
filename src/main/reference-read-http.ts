import type { Hono } from "hono";
import type {
  CardReferenceReadModel,
  ResolveCardReferenceInput,
} from "../shared/block-references";
import type {
  DatabaseViewReadModel,
  ReadDatabaseViewReferenceInput,
} from "../shared/database-views";
import {
  HttpCardReferenceParamsSchema,
  HttpDatabaseViewReferenceParamsSchema,
  HttpDatabaseViewReferenceQuerySchema,
} from "../shared/schemas/http";

export interface ReferenceReadHttpDependencies {
  readonly resolveCardReference: (
    input: ResolveCardReferenceInput,
  ) => CardReferenceReadModel | null | Promise<CardReferenceReadModel | null>;
  readonly readDatabaseViewReference: (
    input: ReadDatabaseViewReferenceInput,
  ) => DatabaseViewReadModel | null | Promise<DatabaseViewReadModel | null>;
}

export const registerReferenceReadHttpRoutes = (
  app: Hono,
  dependencies: ReferenceReadHttpDependencies,
): void => {
  app.get(
    "/api/projects/:projectId/references/cards/:targetBlockId",
    async (context) => {
      const parsed = HttpCardReferenceParamsSchema.safeParse(context.req.param());
      if (!parsed.success) {
        return context.json({ error: "Invalid Card reference request" }, 400);
      }
      const result = await dependencies.resolveCardReference({
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
