"""
People and household tools for the MCP server.
"""

from __future__ import annotations

from app.mcp.dependencies import get_db
from app.mcp.tools._currency import convert_or_none, user_currency
from app.models import Account, Person, Property, Vehicle
from app.services.ownership_service import attribute_amount, get_owners
from app.mcp.tools.investments import INVESTMENT_ACCOUNT_TYPES


def list_people(user_id: str) -> list[dict]:
    """
    List all people in the user's household.

    Args:
        user_id: The user's ID

    Returns:
        List of person dicts with id, name, kind, color.
    """
    with get_db() as db:
        rows = (
            db.query(Person)
            .filter(Person.user_id == user_id)
            .order_by(Person.kind, Person.created_at)
            .all()
        )
        return [{"id": str(p.id), "name": p.name, "kind": p.kind, "color": p.color} for p in rows]


def get_household_summary(user_id: str, person_ids: list[str] | None = None) -> dict:
    """
    Per-person net worth breakdown across cash, investments, properties, vehicles.

    If ``person_ids`` is None, returns one entry per person in the household.
    Otherwise returns entries only for the specified people.

    Args:
        user_id: The user's ID
        person_ids: Optional list of person UUIDs to filter results

    Returns:
        Dict with a ``people`` list; each entry has person_id, name, cash,
        investments, properties, vehicles, total, all stated in ``currency``
        (the user's functional currency). ``unconverted`` counts the assets
        left out of every total because they could not be stated in that
        currency -- a non-zero count means the net worth shown is a floor,
        not the figure.
    """
    with get_db() as db:
        functional_currency = user_currency(db, user_id)
        people = db.query(Person).filter(Person.user_id == user_id).all()
        if person_ids is not None:
            pid_set = set(person_ids)
            people = [p for p in people if str(p.id) in pid_set]

        accounts = (
            db.query(Account).filter(Account.user_id == user_id, Account.is_active.is_(True)).all()
        )
        properties = (
            db.query(Property)
            .filter(Property.user_id == user_id, Property.is_active.is_(True))
            .all()
        )
        vehicles = (
            db.query(Vehicle).filter(Vehicle.user_id == user_id, Vehicle.is_active.is_(True)).all()
        )

        # Cache owners per entity to avoid N*M queries.
        account_owners = {str(a.id): get_owners(db, "account", a.id) for a in accounts}
        property_owners = {str(p.id): get_owners(db, "property", p.id) for p in properties}
        vehicle_owners = {str(v.id): get_owners(db, "vehicle", v.id) for v in vehicles}

        # An asset that cannot be stated in the functional currency is
        # excluded from every total and counted here. `or 0` was the old
        # treatment and it is the worse one: a missing conversion became a
        # zero balance, which reads as "this account is empty" rather than
        # "this account could not be counted". Counted once per asset, not
        # once per owner, so the number means "assets", not "shares".
        unconverted_accounts: set[str] = set()
        unconverted_properties: set[str] = set()
        unconverted_vehicles: set[str] = set()

        # Valuations carry their own currency and there is no stored
        # functional equivalent, so the conversion happens here. Cached per
        # asset: the same property is converted once, not once per owner.
        def _valuation(asset) -> float | None:
            return convert_or_none(
                db,
                float(asset.current_value or 0),
                asset.currency or functional_currency,
                functional_currency,
            )

        property_values = {str(pr.id): _valuation(pr) for pr in properties}
        vehicle_values = {str(v.id): _valuation(v) for v in vehicles}

        out: list[dict] = []
        for person in people:
            pid = str(person.id)
            cash = 0.0
            investments = 0.0
            properties_total = 0.0
            vehicles_total = 0.0

            for a in accounts:
                owners = account_owners[str(a.id)]
                if pid not in {o["person_id"] for o in owners}:
                    continue
                if a.functional_balance is None:
                    unconverted_accounts.add(str(a.id))
                    continue
                amt = attribute_amount(float(a.functional_balance), owners, pid)
                if (a.account_type or "") in INVESTMENT_ACCOUNT_TYPES:
                    investments += amt
                else:
                    cash += amt

            for pr in properties:
                owners = property_owners[str(pr.id)]
                if pid not in {o["person_id"] for o in owners}:
                    continue
                value = property_values[str(pr.id)]
                if value is None:
                    unconverted_properties.add(str(pr.id))
                    continue
                properties_total += attribute_amount(value, owners, pid)

            for v in vehicles:
                owners = vehicle_owners[str(v.id)]
                if pid not in {o["person_id"] for o in owners}:
                    continue
                value = vehicle_values[str(v.id)]
                if value is None:
                    unconverted_vehicles.add(str(v.id))
                    continue
                vehicles_total += attribute_amount(value, owners, pid)

            out.append(
                {
                    "person_id": pid,
                    "name": person.name,
                    "currency": functional_currency,
                    "cash": round(cash, 2),
                    "investments": round(investments, 2),
                    "properties": round(properties_total, 2),
                    "vehicles": round(vehicles_total, 2),
                    "total": round(cash + investments + properties_total + vehicles_total, 2),
                }
            )
        return {
            "currency": functional_currency,
            "people": out,
            "unconverted": {
                "accounts": len(unconverted_accounts),
                "properties": len(unconverted_properties),
                "vehicles": len(unconverted_vehicles),
            },
        }
