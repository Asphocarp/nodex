import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ContentAccessContext } from "../../../shared/content-access-context";
import type { DatabasePropertyOption } from "../../../shared/database-kernel";
import type { DataSourcePropertyRecordV2 } from "../../../shared/database-module-v2";
import { readDatabasePropertyOptions } from "@/lib/database-view-authoring";
import {
  mergePropertyOptionPages,
  propertyOptionWindowMatchesProjection,
  readPropertyOptionWindow,
} from "@/lib/database-property-options-runtime";
import type { DataSourcePropertyOptionRegistryState } from "./data-source-property-editor-binding";

interface PropertyOptionRegistryEntry {
  readonly options: readonly DatabasePropertyOption[];
  readonly state: DataSourcePropertyOptionRegistryState;
  readonly nextCursor: string | null;
  readonly projectionRevision: number | null;
  readonly seenCursors: readonly string[];
  readonly loadingMore: boolean;
}

const isOptionProperty = (
  property: DataSourcePropertyRecordV2,
): boolean => property.lifecycle === "active"
  && (property.valueType === "select" || property.valueType === "multi_select");

const initialEntry = (
  property: DataSourcePropertyRecordV2,
): PropertyOptionRegistryEntry => {
  const options = readDatabasePropertyOptions(property);
  return {
    options,
    state: options.length >= property.optionCount ? "ready" : "idle",
    nextCursor: null,
    projectionRevision: null,
    seenCursors: [],
    loadingMore: false,
  };
};

/** Shared, picker-driven option-window authority for Page Stage and Database View. */
export function usePropertyOptionRegistries({
  accessContext,
  properties,
}: {
  readonly accessContext: ContentAccessContext;
  readonly properties: readonly DataSourcePropertyRecordV2[];
}) {
  const [entries, setEntries] = useState<Readonly<Record<
    string,
    PropertyOptionRegistryEntry
  >>>({});
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const propertiesRef = useRef(properties);
  propertiesRef.current = properties;
  const generationRef = useRef(0);
  const loadsRef = useRef(new Map<string, Promise<void>>());
  const propertyAuthorityKey = JSON.stringify([
    accessContext.kind === "project"
      ? ["project", accessContext.projectId]
      : ["library"],
    properties.map((property) => [
      property.dataSourceId,
      property.propertyId,
      property.revision,
      property.lifecycle,
      property.optionCount,
    ]),
  ]);

  useLayoutEffect(() => {
    generationRef.current += 1;
    loadsRef.current.clear();
    setEntries(Object.fromEntries(
      propertiesRef.current
        .filter(isOptionProperty)
        .map((property) => [property.propertyId, initialEntry(property)]),
    ));
  }, [propertyAuthorityKey]);

  const load = useCallback((property: DataSourcePropertyRecordV2, continuation: boolean) => {
    if (!isOptionProperty(property)) return;
    const propertyId = property.propertyId;
    const current = entriesRef.current[propertyId] ?? initialEntry(property);
    if (loadsRef.current.has(propertyId)) return;
    if (continuation && (!current.nextCursor || current.state !== "ready")) return;
    if (!continuation && current.state === "ready") return;
    const after = continuation ? current.nextCursor : null;
    const generation = generationRef.current;
    setEntries((all) => ({
      ...all,
      [propertyId]: {
        ...(all[propertyId] ?? current),
        state: continuation ? "ready" : "loading",
        loadingMore: continuation,
      },
    }));

    const read = async () => {
      let replace = after === null;
      let page;
      try {
        page = await readPropertyOptionWindow(accessContext, property, after);
      } catch (cause) {
        if (after === null) throw cause;
        page = await readPropertyOptionWindow(accessContext, property, null);
        replace = true;
      }
      const latest = entriesRef.current[propertyId] ?? current;
      if (
        after !== null
        && !propertyOptionWindowMatchesProjection(
          latest.projectionRevision,
          page.projectionRevision,
        )
      ) {
        page = await readPropertyOptionWindow(accessContext, property, null);
        replace = true;
      }
      const seenCursors = replace ? [] : latest.seenCursors;
      if (page.nextCursor && seenCursors.includes(page.nextCursor)) {
        throw new Error("Property option registry returned a repeated cursor");
      }
      const options = replace
        ? page.options
        : mergePropertyOptionPages(latest.options, page.options);
      if (options.length > Math.max(property.optionCount, 10_000)) {
        throw new Error("Property option registry exceeded its declared bound");
      }
      if (generationRef.current !== generation) return;
      setEntries((all) => ({
        ...all,
        [propertyId]: {
          options,
          state: "ready",
          nextCursor: page.nextCursor,
          projectionRevision: page.projectionRevision,
          seenCursors: page.nextCursor
            ? [...seenCursors, page.nextCursor]
            : seenCursors,
          loadingMore: false,
        },
      }));
    };
    const request = read()
      .catch((cause: unknown) => {
        if (generationRef.current !== generation) return;
        console.error("Failed to load property options", cause);
        setEntries((all) => ({
          ...all,
          [propertyId]: {
            ...(all[propertyId] ?? current),
            state: "error",
            loadingMore: false,
          },
        }));
      })
      .finally(() => {
        if (loadsRef.current.get(propertyId) === request) {
          loadsRef.current.delete(propertyId);
        }
      });
    loadsRef.current.set(propertyId, request);
  }, [accessContext]);

  const requestOptions = useCallback(
    (property: DataSourcePropertyRecordV2) => load(property, false),
    [load],
  );
  const requestMoreOptions = useCallback(
    (property: DataSourcePropertyRecordV2) => load(property, true),
    [load],
  );

  return useMemo(() => ({
    options: Object.fromEntries(
      Object.entries(entries).map(([propertyId, entry]) => [propertyId, entry.options]),
    ) as Readonly<Record<string, readonly DatabasePropertyOption[]>>,
    states: Object.fromEntries(
      Object.entries(entries).map(([propertyId, entry]) => [propertyId, entry.state]),
    ) as Readonly<Record<string, DataSourcePropertyOptionRegistryState>>,
    hasMore: Object.fromEntries(
      Object.entries(entries).map(([propertyId, entry]) => [
        propertyId,
        entry.nextCursor !== null,
      ]),
    ) as Readonly<Record<string, boolean>>,
    loadingMore: Object.fromEntries(
      Object.entries(entries).map(([propertyId, entry]) => [propertyId, entry.loadingMore]),
    ) as Readonly<Record<string, boolean>>,
    requestOptions,
    requestMoreOptions,
  }), [entries, requestMoreOptions, requestOptions]);
}
