"""
One-off backfill: re-enrich existing `brokers` rows with MOTUS account data
(email, contact/officer name, confirmed address) for rows saved before
motus_account_lookup() existed in broker_scraper.py — i.e. rows that still
have email=None / email_confidence='not_found'.

Safe to re-run: only touches rows missing an email, and does nothing when
the MOTUS lookup for a USDOT comes back empty.

Usage:
    python src/scripts/backfill_motus.py
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from broker_scraper import (  # noqa: E402
    MOTUS_DELAY_SECONDS,
    SUPABASE_KEY,
    SUPABASE_URL,
    log,
    motus_account_lookup,
    parse_motus_address,
)
from supabase import create_client  # noqa: E402


def main() -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("ERROR: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local")
        sys.exit(1)

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    result = (
        supabase.table("brokers")
        .select("id, dot_number, company_name, email, contact_name")
        .execute()
    )
    rows = [r for r in result.data if r.get("dot_number") and not r.get("email")]
    log(f"{len(rows)} brokers missing an email — backfilling from MOTUS account pages")

    updated = 0
    for i, row in enumerate(rows, 1):
        usdot = row["dot_number"]
        log(f"[{i}/{len(rows)}] USDOT {usdot} — {row['company_name']}")

        motus = motus_account_lookup(usdot)
        if motus.get("error"):
            log(f"  MOTUS lookup failed: {motus['error']}")
            time.sleep(MOTUS_DELAY_SECONDS)
            continue

        officials = motus.get("officials") or []
        contact_name = officials[0]["name"] if officials else row.get("contact_name")
        email = motus.get("email")

        raw_address = motus.get("principal_address") or motus.get("mailing_address")

        update: dict = {
            "contact_name": contact_name,
            "email": email,
            "email_confidence": "found" if email else "not_found",
        }
        if motus.get("phone"):
            update["phone"] = motus["phone"]
        if raw_address:
            address = parse_motus_address(raw_address)
            update.update(
                {
                    "address_line1": address["address_line1"],
                    "city": address["city"],
                    "state": address["state"],
                    "zip": address["zip"],
                }
            )

        supabase.table("brokers").update(update).eq("id", row["id"]).execute()
        log(f"  email: {email or '—'}  officer: {contact_name or '—'}")
        if email:
            updated += 1

        time.sleep(MOTUS_DELAY_SECONDS)

    log(f"Done — {updated}/{len(rows)} brokers backfilled with an email")


if __name__ == "__main__":
    main()
