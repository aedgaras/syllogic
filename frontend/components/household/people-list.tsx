"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { PersonForm, type PersonFormValues } from "./person-form";
import { PersonAvatar } from "./person-avatar";
import {
  fetchPeople,
  createPersonRequest,
  deletePersonRequest,
  invalidateHouseholdQueries,
  peopleQueryKey,
  updatePersonRequest,
  usePeopleQuery,
  type ClientPerson,
} from "@/lib/people/client";

function buildFormData(values: PersonFormValues): FormData {
  const fd = new FormData();
  fd.set("name", values.name);
  fd.set("color", values.color);
  if (values.avatar) fd.set("avatar", values.avatar);
  if (values.clearAvatar) fd.set("clearAvatar", "1");
  return fd;
}

export function PeopleList(props: { initialPeople: ClientPerson[] }) {
  const queryClient = useQueryClient();
  const { data: people = [] } = usePeopleQuery(props.initialPeople);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = () =>
    queryClient.fetchQuery({ queryKey: peopleQueryKey, queryFn: fetchPeople });

  const createMutation = useMutation({
    mutationFn: (values: PersonFormValues) =>
      createPersonRequest(buildFormData(values)),
    onSuccess: async () => {
      invalidateHouseholdQueries(queryClient);
      await refresh();
      setAdding(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: PersonFormValues }) =>
      updatePersonRequest(id, buildFormData(values)),
    onSuccess: async () => {
      invalidateHouseholdQueries(queryClient);
      await refresh();
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deletePersonRequest,
    onSuccess: async () => {
      invalidateHouseholdQueries(queryClient);
      await refresh();
    },
  });

  async function create(values: PersonFormValues) {
    await createMutation.mutateAsync(values);
  }

  async function update(id: string, values: PersonFormValues) {
    await updateMutation.mutateAsync({ id, values });
  }

  async function remove(id: string) {
    try {
      await deleteMutation.mutateAsync(id);
    } catch (err) {
      const blockers = (err as { blockers?: unknown[] }).blockers;
      if (!blockers) throw err;
      alert(
        `Cannot delete: this person is the sole owner of ${blockers.length} item(s). Reassign first.`
      );
    }
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-md border">
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-3 p-3">
            <PersonAvatar person={p} size={36} />
            <span className="flex-1 font-medium">{p.name}</span>
            {p.kind === "self" && (
              <span className="text-xs text-muted-foreground">you</span>
            )}
            <Button variant="ghost" size="sm" onClick={() => setEditingId(p.id)}>
              Edit
            </Button>
            {p.kind !== "self" && (
              <Button variant="ghost" size="sm" onClick={() => remove(p.id)}>
                Delete
              </Button>
            )}
          </li>
        ))}
      </ul>

      {editingId && (
        <div className="rounded-md border p-4">
          <h2 className="mb-3 font-medium">
            Edit {people.find((p) => p.id === editingId)?.name}
          </h2>
          <PersonForm
            initial={{
              name: people.find((p) => p.id === editingId)!.name,
              color: people.find((p) => p.id === editingId)!.color ?? undefined,
              avatarUrl: people.find((p) => p.id === editingId)!.avatarUrl ?? undefined,
            }}
            submitLabel="Save"
            onSubmit={(v) => update(editingId, v)}
            onCancel={() => setEditingId(null)}
          />
        </div>
      )}

      {adding ? (
        <div className="rounded-md border p-4">
          <h2 className="mb-3 font-medium">Add person</h2>
          <PersonForm
            submitLabel="Add person"
            onSubmit={create}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : (
        <Button variant="outline" onClick={() => setAdding(true)}>
          Add person
        </Button>
      )}
    </div>
  );
}
