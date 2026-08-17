"use client";

import { PersonAvatar } from "./person-avatar";
import type { EntityType } from "@/lib/people";
import {
  useOwnersQuery,
  usePeopleQuery,
  type ClientPerson,
  type OwnerRow,
} from "@/lib/people/client";

/**
 * Renders a stacked-avatar row of the people who own this entity.
 * Hidden in single-person households (only one person total).
 *
 * Pass `people` and `ownerIds` to skip the client fetch entirely — list pages
 * preload these server-side to avoid even the batched round trip.
 */
export function OwnerBadges({
  entityType,
  entityId,
  size = 24,
  max = 3,
  people: peopleProp,
  ownerIds: ownerIdsProp,
}: {
  entityType: EntityType;
  entityId: string;
  size?: number;
  max?: number;
  people?: ClientPerson[];
  ownerIds?: string[];
}) {
  const preloaded = peopleProp !== undefined && ownerIdsProp !== undefined;
  const { data: people = [] } = usePeopleQuery(peopleProp);
  const { data: ownersRows = [] } = useOwnersQuery(entityType, entityId, {
    enabled: !preloaded,
    initialOwners: ownerIdsProp?.map<OwnerRow>((personId) => ({
      personId,
      share: null,
    })),
  });
  const ownerIds = ownersRows.map((o) => o.personId);

  if (people.length < 2) return null;
  const owners = people.filter((p) => ownerIds.includes(p.id));
  if (owners.length === 0) return null;

  const visible = owners.slice(0, max);
  const overflow = owners.length - visible.length;

  return (
    <div className="flex items-center -space-x-2">
      {visible.map((p) => (
        <PersonAvatar key={p.id} person={p} size={size} ring />
      ))}
      {overflow > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground ring-2 ring-background"
          style={{ width: size, height: size }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
