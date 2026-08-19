import { getBackendBaseUrl } from "@/lib/backend-url";
import { createInternalAuthHeaders } from "@/lib/internal-auth";

export interface BackendCategory {
  id: string;
  userId: string;
  name: string;
  parentId: string | null;
  categoryType: "expense" | "income" | "transfer";
  color: string | null;
  icon: string | null;
  description: string | null;
  categorizationInstructions: string | null;
  isSystem: boolean;
  hideFromSelection: boolean;
  systemKey: string | null;
  createdAt: Date;
}

interface CategoryApiResponse {
  id: string;
  name: string;
  parent_id: string | null;
  category_type: string;
  color: string | null;
  icon: string | null;
  description: string | null;
  categorization_instructions: string | null;
  is_system: boolean;
  hide_from_selection: boolean;
  system_key: string | null;
  created_at: string;
}

function mapCategory(userId: string, data: CategoryApiResponse): BackendCategory {
  return {
    id: data.id,
    userId,
    name: data.name,
    parentId: data.parent_id,
    categoryType: data.category_type as BackendCategory["categoryType"],
    color: data.color,
    icon: data.icon,
    description: data.description,
    categorizationInstructions: data.categorization_instructions,
    isSystem: data.is_system,
    hideFromSelection: data.hide_from_selection,
    systemKey: data.system_key,
    createdAt: new Date(data.created_at),
  };
}

async function extractErrorDetail(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => ({ detail: fallback }));
  const detail = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail;
  return typeof detail === "string" ? detail : fallback;
}

function backendFetch(
  method: string,
  path: string,
  userId: string,
  body?: unknown,
) {
  const serializedBody = body !== undefined ? JSON.stringify(body) : undefined;
  return fetch(`${getBackendBaseUrl().replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...createInternalAuthHeaders({
        method,
        pathWithQuery: path,
        userId,
        body: serializedBody ?? "",
      }),
    },
    body: serializedBody,
  });
}

export async function fetchCategoriesViaBackend(
  userId: string,
): Promise<BackendCategory[]> {
  const response = await backendFetch("GET", "/api/categories/", userId);
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to fetch categories"));
  }
  const data: CategoryApiResponse[] = await response.json();
  return data.map((item) => mapCategory(userId, item));
}

export interface CreateCategoryPayload {
  name: string;
  categoryType: "expense" | "income" | "transfer";
  color: string;
  icon: string;
  description?: string;
  categorizationInstructions?: string;
}

export async function createCategoryViaBackend(
  userId: string,
  input: CreateCategoryPayload,
): Promise<BackendCategory> {
  const response = await backendFetch("POST", "/api/categories/", userId, {
    name: input.name,
    category_type: input.categoryType,
    color: input.color,
    icon: input.icon,
    description: input.description,
    categorization_instructions: input.categorizationInstructions,
  });
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to create category"));
  }
  return mapCategory(userId, await response.json());
}

export interface UpdateCategoryPayload {
  name?: string;
  color?: string;
  icon?: string;
  description?: string;
  categorizationInstructions?: string;
}

export async function updateCategoryViaBackend(
  userId: string,
  categoryId: string,
  input: UpdateCategoryPayload,
): Promise<BackendCategory> {
  const response = await backendFetch(
    "PATCH",
    `/api/categories/${categoryId}`,
    userId,
    {
      name: input.name,
      color: input.color,
      icon: input.icon,
      description: input.description,
      categorization_instructions: input.categorizationInstructions,
    },
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to update category"));
  }
  return mapCategory(userId, await response.json());
}

export async function deleteCategoryViaBackend(
  userId: string,
  categoryId: string,
  reassignToCategoryId?: string | null,
): Promise<{ reassignedCount: number }> {
  const response = await backendFetch(
    "DELETE",
    `/api/categories/${categoryId}`,
    userId,
    { reassign_to_category_id: reassignToCategoryId ?? null },
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to delete category"));
  }
  const data: { reassigned_count: number } = await response.json();
  return { reassignedCount: data.reassigned_count };
}

export async function getCategoryStatsViaBackend(
  userId: string,
  categoryId: string,
): Promise<{ transactionCount: number }> {
  const response = await backendFetch(
    "GET",
    `/api/categories/${categoryId}/stats`,
    userId,
  );
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, "Failed to count transactions"));
  }
  const data: { transaction_count: number } = await response.json();
  return { transactionCount: data.transaction_count };
}

export interface SystemTransferCategorySeed {
  key: string;
  name: string;
  categoryType: "expense" | "income" | "transfer";
  color: string;
  icon: string;
  description?: string;
  hideFromSelection?: boolean;
}

export async function ensureSystemTransferCategoriesViaBackend(
  userId: string,
  categories: SystemTransferCategorySeed[],
): Promise<BackendCategory[]> {
  const response = await backendFetch(
    "POST",
    "/api/categories/ensure-system-transfer-categories",
    userId,
    {
      categories: categories.map((c) => ({
        key: c.key,
        name: c.name,
        category_type: c.categoryType,
        color: c.color,
        icon: c.icon,
        description: c.description,
        hide_from_selection: c.hideFromSelection ?? false,
      })),
    },
  );
  if (!response.ok) {
    throw new Error(
      await extractErrorDetail(response, "Failed to backfill system transfer categories"),
    );
  }
  const data: CategoryApiResponse[] = await response.json();
  return data.map((item) => mapCategory(userId, item));
}
