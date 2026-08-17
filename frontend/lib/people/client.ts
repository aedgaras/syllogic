"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { EntityType } from "./queries";

export type ClientPerson = {
  id: string;
  name: string;
  kind: string;
  color?: string | null;
  avatarUrl?: string | null;
};

export type OwnerRow = { personId: string; share: number | null };

export const peopleQueryKey = ["people"] as const;

export function ownersQueryKey(entityType: EntityType, entityId: string) {
  return ["owners", entityType, entityId] as const;
}

export async function fetchPeople(): Promise<ClientPerson[]> {
  const response = await fetch("/api/people");
  if (!response.ok) {
    throw new Error("Failed to load household");
  }
  const data = await response.json();
  return Array.isArray(data?.people) ? data.people : [];
}

export async function fetchOwners(
  entityType: EntityType,
  entityId: string,
): Promise<OwnerRow[]> {
  const response = await fetch(`/api/owners/${entityType}/${entityId}`);
  if (!response.ok) {
    throw new Error("Failed to load owners");
  }
  const data = await response.json();
  return Array.isArray(data?.owners) ? data.owners : [];
}

export async function saveOwners(
  entityType: EntityType,
  entityId: string,
  owners: OwnerRow[],
) {
  const response = await fetch(`/api/owners/${entityType}/${entityId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owners }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "request failed");
    throw new Error(`Failed to save owners: ${text.slice(0, 200)}`);
  }
}

export async function createPersonRequest(body: FormData) {
  const response = await fetch("/api/people", { method: "POST", body });
  if (!response.ok) throw new Error("Failed to create person");
}

export async function updatePersonRequest(id: string, body: FormData) {
  const response = await fetch(`/api/people/${id}`, { method: "PATCH", body });
  if (!response.ok) throw new Error("Failed to update person");
}

export async function deletePersonRequest(id: string) {
  const response = await fetch(`/api/people/${id}`, { method: "DELETE" });
  if (response.status === 409) {
    const data = await response.json();
    throw Object.assign(new Error("sole owner"), { blockers: data.blockers });
  }
  if (!response.ok) throw new Error("Failed to delete person");
}

export function invalidateHouseholdQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: peopleQueryKey });
  queryClient.invalidateQueries({ queryKey: ["owners"] });
}

export function usePeopleQuery(initialPeople?: ClientPerson[]) {
  return useQuery({
    queryKey: peopleQueryKey,
    queryFn: fetchPeople,
    initialData: initialPeople,
  });
}

export function useOwnersQuery(
  entityType: EntityType,
  entityId: string,
  options?: { enabled?: boolean; initialOwners?: OwnerRow[] },
) {
  return useQuery({
    queryKey: ownersQueryKey(entityType, entityId),
    queryFn: () => fetchOwners(entityType, entityId),
    enabled: options?.enabled ?? true,
    initialData: options?.initialOwners,
  });
}

export function useSaveOwnersMutation(
  entityType: EntityType,
  entityId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (owners: OwnerRow[]) =>
      saveOwners(entityType, entityId, owners),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ownersQueryKey(entityType, entityId),
      });
    },
  });
}
