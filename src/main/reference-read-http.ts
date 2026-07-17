import type { Hono } from "hono";
import type {
  PageTargetReadModel,
  ResolvePageTargetInput,
} from "../shared/page-targets";
import type {
  PageOwnershipPathReadModel,
  ResolvePageOwnershipPathInput,
} from "../shared/page-ownership-paths";
import type {
  DatabaseViewReadModel,
  ReadDatabaseViewReferenceInput,
} from "../shared/database-views";
import {
  HttpPageTargetParamsSchema,
  HttpDatabaseViewReferenceParamsSchema,
  HttpDatabaseViewReferenceQuerySchema,
} from "../shared/schemas/http";

export interface ReferenceReadHttpDependencies {
  readonly resolvePageTarget: (
    input: ResolvePageTargetInput,
  ) => PageTargetReadModel | null | Promise<PageTargetReadModel | null>;
  readonly resolvePageOwnershipPath: (
    input: ResolvePageOwnershipPathInput,
  ) => PageOwnershipPathReadModel | null | Promise<PageOwnershipPathReadModel | null>;
  readonly readDatabaseViewReference: (
    input: ReadDatabaseViewReferenceInput,
  ) => DatabaseViewReadModel | null | Promise<DatabaseViewReadModel | null>;
}

export const registerReferenceReadHttpRoutes = (
  app: Hono,
  dependencies: ReferenceReadHttpDependencies,
): void => {
  app.get(
    "/api/projects/:projectId/page-targets/:pageId",
    async (context) => {
      const parsed = HttpPageTargetParamsSchema.safeParse(context.req.param());
      if (!parsed.success) {
        return context.json({ error: "Invalid Page target request" }, 400);
      }
      const result = await dependencies.resolvePageTarget({
        requestingProjectId: parsed.data.projectId,
        targetPageId: parsed.data.pageId,
      });
      if (!result) return context.json({ error: "Project not found" }, 404);
      context.header("Cache-Control", "no-store");
      return context.json(result);
    },
  );

  app.get(
    "/api/projects/:projectId/page-targets/:pageId/ownership-path",
    async (context) => {
      const parsed = HttpPageTargetParamsSchema.safeParse(context.req.param());
      if (!parsed.success) {
        return context.json({ error: "Invalid Page ownership path request" }, 400);
      }
      const result = await dependencies.resolvePageOwnershipPath({
        requestingProjectId: parsed.data.projectId,
        targetPageId: parsed.data.pageId,
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
