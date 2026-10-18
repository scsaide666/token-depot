import "server-only";
import type { z } from "zod";
import { requireAdmin } from "../session";
import { HttpError, json, requestFailure, requireAdminApiSession } from "../http";
import { parseAnalyticsQuery, pageQueryParams } from "../analytics-query";

export async function adminRead<Q, T>(request: Request, schema: z.ZodType<Q>, read: (query: Q) => Promise<T>) {
  try {
    await requireAdminApiSession();
    return json(await read(parseAnalyticsQuery(new URL(request.url).searchParams, schema)));
  } catch (error) { return requestFailure(error); }
}

export async function adminPageData<Q, T>(params: Promise<Record<string, string | string[] | undefined>>, schema: z.ZodType<Q>, read: (query: Q) => Promise<T>) {
  await requireAdmin();
  try {
    return { data: await read(parseAnalyticsQuery(pageQueryParams(await params), schema)), error: "" };
  } catch (error) {
    if (error instanceof HttpError && error.status === 400) return { data: undefined, error: error.message };
    throw error;
  }
}
