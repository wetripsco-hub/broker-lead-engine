"""
Broker-only lead pipeline for Broker Lead Engine.

Discovers newly-filed freight brokers (property + household goods only —
truckers/forwarders/passenger carriers are skipped) from the FMCSA daily
publication PDF, enriches each one from MOTUS, then writes new brokers to
Supabase. The existing `on_broker_inserted` DB trigger auto-creates a
'new'-stage lead for each.

STATUS (verified against real runs, 2026-09-23):
  - PDF discovery + download: WORKING, via MOTUS's own public JSON
    API (no auth, ~450ms) — GET
    /api/report/getSignedUrlByTypeAndDateRange/REGISTER/{start}/{end}
    returns the pre-signed S3 URL for every register published in a
    date range. Replaced driving the publications page's Material-UI
    form in a browser. Dates with no publication are simply absent
    from the response: FMCSA only publishes on business days.
  - PDF parsing: WORKING — verified 33/33 property-broker rows parsed
    correctly from a real REGISTER PDF.
  - SAFER enrichment: REMOVED. It cost ~4s per broker (fetch plus
    pacing) to supply an MC number, address and operating status that
    the MOTUS API below already returns, more authoritatively, in the
    same call that fetches everything else.
  - MOTUS lookup (email + officials + authority + address): WORKING,
    via MOTUS's own public JSON API (no auth, ~390ms per broker) —
    GET /api/carriers/{usdot}, the same endpoint its account page
    calls. Returns USDOT status, legal/DBA name, principal + mailing
    addresses (pre-split into line/city/state/zip), business phone and
    email, every company official (name/title/phone/email) and every
    operating authority (type, MC number, status). This replaces both
    the old Google/DuckDuckGo email search AND the later browser-based
    DOM scrape of the same page — see motus_account_lookup().
  - Email discovery via search engines: REMOVED. Both Google (429
    "/sorry/index") and DuckDuckGo (image CAPTCHA) blocked automated
    search outright, confirmed from this sandbox AND the operator's
    own residential IP — the MOTUS account page (above) makes this
    unnecessary anyway, so the search-engine code was deleted rather
    than kept unused. If MOTUS ever gets locked down, a paid provider
    (Hunter.io, SerpAPI, ...) would need wiring in here instead.

RUN LOCALLY ONLY — Vercel has no Python runtime; see the architecture
note in app/api/scrape/run/route.ts. Note that the browser requirement
is gone: every step is now a plain HTTP call, so this could be ported to
TypeScript and run on Vercel Cron if that's ever wanted.

Usage:
    pip install -r src/scripts/requirements.txt
    python src/scripts/broker_scraper.py

Reads Supabase credentials from the repo's .env.local (same variables the
Next.js app uses: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) so
there is only one place secrets live.
"""

import io
import os
import re
import sys
import time

# Windows' default console codepage (cp1252) can't encode characters this
# script logs (→, —, …) — confirmed on a real run: it either crashed with
# UnicodeEncodeError mid-step (making a successful step look like a failure)
# or silently mangled them into "�". Force UTF-8 on stdout/stderr so log
# output is always correct regardless of the host console's codepage.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pdfplumber
import requests
from dotenv import load_dotenv
from supabase import Client, create_client

# ── Config ───────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env.local")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# The JSON APIs behind MOTUS's own pages — see find_register_pdf() and
# motus_account_lookup() for why we call these directly instead of
# rendering the pages that call them.
MOTUS_REPORTS_URL = (
    "https://motus.dot.gov/api/report/getSignedUrlByTypeAndDateRange/REGISTER/{start}/{end}"
)
MOTUS_API_URL = "https://motus.dot.gov/api/carriers/{usdot}"
MOTUS_USER_AGENT = "Mozilla/5.0"
# The MOTUS API answers in ~0.4s, so this is politeness pacing for a
# government endpoint rather than a wait for anything to load.
MOTUS_DELAY_SECONDS = 1

SECTION_HEADERS = {
    "property": "BROKER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)",
    "household_goods": "BROKER OF HOUSEHOLD GOODS",
}

# CONFIRMED against a real REGISTER PDF (2026-09-16). This is a plain table
# — NOT labeled fields — with columns:
#   USDOT Number | Legal Business Name | Filing Date | Business Mailing
#   Address | Company Officer | Business Telephone
# repeated as a page-header row every page. A data row looks like:
#   "5155245 TOAPANTA 09/15/2026 1056 N Ridgeway, Chicago, IL 60651 US
#    Marco Toaquiza +1 (312) 487-7057"
# with the company name (and sometimes address/officer) wrapping to a
# following line when it's long — pdfplumber's plain extract_text() does
# not reliably preserve column order for wrapped multi-line rows, so
# address/officer are left to the MOTUS enrichment step rather than
# parsed here; only usdot/company_name/filing_date/phone (all on the
# anchor line) are extracted with confidence.
DATA_ROW_RE = re.compile(r"^(\d{6,8})\s+(.+?)\s+(\d{2}/\d{2}/\d{4})\s+(.*)$")
PHONE_TAIL_RE = re.compile(r"(\+?1?\s?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})\s*$")
# A continuation line is almost certainly just the company name wrapping
# (e.g. "TRANSPORTATION LLC", "GROUP") when it's pure text with no digits —
# a line WITH digits is address/zip overflow that got reordered by column
# wrapping, which is unsafe to blindly merge into the name.
NAME_CONTINUATION_RE = re.compile(r"^[A-Za-z .,&'\-]+$")


def log(msg: str) -> None:
    """Progress line — the Next.js API route streams stdout verbatim."""
    print(f"[scraper] {msg}", flush=True)


# ── Step 1: PDF discovery + parsing ─────────────────────────────────────────

def list_registers(start: "date", end: "date") -> list[dict]:
    """
    Every daily register published between start and end (inclusive), as
    [{"date": "YYYY-MM-DD", "url": <pre-signed S3 URL>}], oldest first.

    Dates with no publication are simply absent from the response — FMCSA
    only publishes on business days, so weekends and federal holidays have
    no register at all.
    """
    resp = requests.get(
        MOTUS_REPORTS_URL.format(start=start.isoformat(), end=end.isoformat()),
        timeout=30,
        headers={"User-Agent": MOTUS_USER_AGENT, "Accept": "application/json"},
    )
    resp.raise_for_status()
    entries = resp.json().get("Register") or []
    return sorted(
        ({"date": e["date"], "url": e["url"]} for e in entries if e.get("url")),
        key=lambda e: e["date"],
    )


def find_register_pdf(target_date: "date | None" = None) -> tuple[str, str]:
    """
    Returns (register_date, pdf_url) for the requested day, or for the most
    recent published day when target_date is None.

    Uses the same endpoint the publications page itself calls:
    GET /api/report/getSignedUrlByTypeAndDateRange/REGISTER/{start}/{end},
    public and no auth. This replaced driving that page's Material-UI form
    in a browser (fill both date fields, tick the document-type checkbox,
    click Apply, then intercept the download request) — the endpoint hands
    back the same pre-signed S3 URLs directly in ~450ms.

    The S3 bucket itself is private, so the URL still has to come from
    MOTUS rather than being constructed; the signature expires in 900s,
    which is plenty since we download immediately.
    """
    if target_date is not None:
        registers = list_registers(target_date, target_date)
        if registers:
            return registers[0]["date"], registers[0]["url"]

        # Nothing published that day. Look around it so the error can say
        # which dates DO work instead of just failing — the usual cause is
        # picking a weekend or a federal holiday.
        nearby = list_registers(target_date - timedelta(days=7), target_date + timedelta(days=2))
        available = ", ".join(r["date"] for r in nearby) or "none in the surrounding week"
        raise RuntimeError(
            f"FMCSA published no daily register for {target_date.isoformat()} "
            f"({target_date.strftime('%A')}) — registers only exist for business "
            f"days. Dates near it that do have one: {available}"
        )

    today = date.today()
    registers = list_registers(today - timedelta(days=7), today)
    if not registers:
        raise RuntimeError(
            f"FMCSA published no daily register between "
            f"{(today - timedelta(days=7)).isoformat()} and {today.isoformat()}"
        )
    latest = registers[-1]
    return latest["date"], latest["url"]

def download_pdf(url: str) -> bytes:
    resp = requests.get(url, timeout=60, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    return resp.content


def parse_pdf(pdf_bytes: bytes) -> list[dict]:
    """Extracts broker records from the two target sections only."""
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        full_text = "\n".join(page.extract_text() or "" for page in pdf.pages)

    lines = full_text.split("\n")
    records: list[dict] = []
    current_section: str | None = None

    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        upper = stripped.upper()

        if SECTION_HEADERS["property"] in upper:
            current_section = "property"
            i += 1
            continue
        if SECTION_HEADERS["household_goods"] in upper:
            current_section = "household_goods"
            i += 1
            continue
        # Any other all-caps heading (a different entity type — e.g.
        # "ENTERPRISE MOTOR CARRIER OF..." / "FREIGHT FORWARDER OF...",
        # which also mention "PROPERTY (EXCEPT HOUSEHOLD GOODS)" but are
        # NOT brokers) ends our section until a broker header reappears.
        # Must exclude both data rows AND wrapped continuation/overflow
        # lines: officer names / cities in this PDF are often ALL CAPS
        # too (e.g. "...RASHID FAYEQ 510..."), and multi-line rows leave
        # junk fragments like "CARRIERS LLC CA 94513-7505 US TAWFIQ
        # RASHID" that are neither a real heading nor a new record start.
        # Every real entity-type heading in this PDF contains " OF ".
        if (
            stripped.isupper()
            and len(stripped) > 15
            and "BROKER OF" not in upper
            and " OF " in upper
            and not stripped[:1].isdigit()
        ):
            current_section = None
            i += 1
            continue

        if current_section:
            m = DATA_ROW_RE.match(stripped)
            if m:
                usdot, name, filing_date, rest = m.groups()

                # Merge a pure-text continuation line (no digits) into the
                # company name — it's almost always the name wrapping.
                if i + 1 < len(lines):
                    nxt = lines[i + 1].strip()
                    nxt_upper = nxt.upper()
                    is_section_header = (
                        SECTION_HEADERS["property"] in nxt_upper
                        or SECTION_HEADERS["household_goods"] in nxt_upper
                    )
                    if nxt and NAME_CONTINUATION_RE.match(nxt) and not is_section_header:
                        name = f"{name} {nxt}"
                        i += 1  # consumed the continuation line

                name = re.sub(r"\s+US$", "", name).strip()
                phone_match = PHONE_TAIL_RE.search(rest)

                records.append({
                    "usdot": usdot,
                    "company_name": name,
                    "filing_date": filing_date,
                    # Address/officer aren't reliably parseable when a row
                    # wraps (column order gets scrambled in plain text
                    # extraction) — left for the MOTUS enrichment step.
                    "address": None,
                    "officer": None,
                    "phone": phone_match.group(1).strip() if phone_match else None,
                    "broker_type": current_section,
                })

        i += 1

    return records


# ── Step 3: MOTUS account lookup (email + officials + confirmed address) ────

# CONFIRMED against a real account page (USDOT 4551039, 2026-09-23):
#   "9746 FM 605, Merkel, TX 79536"  →  line1 / city / state / zip
ADDRESS_RE = re.compile(r"^(.+),\s*([A-Za-z .'\-]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$")


def parse_motus_address(raw: str | None) -> dict:
    if not raw:
        return {"address_line1": None, "city": None, "state": None, "zip": None}
    m = ADDRESS_RE.match(raw.strip())
    if not m:
        # Doesn't match the usual "street, city, ST zip" shape — keep the
        # whole thing in address_line1 rather than dropping it.
        return {"address_line1": raw.strip(), "city": None, "state": None, "zip": None}
    return {
        "address_line1": m.group(1).strip(),
        "city": m.group(2).strip(),
        "state": m.group(3).strip(),
        "zip": m.group(4).strip(),
    }


MOTUS_EMPTY_RECORD = {
    "usdot_status": None,
    "legal_name": None,
    "dba_name": None,
    "principal_address": None,
    "mailing_address": None,
    "phone": None,
    "email": None,
    "officials": [],
    "authorities": [],
    "authority_type": None,
    "mc_number": None,
    "mc_status": None,
    "error": None,
}

# Status preference when a broker holds several operating authorities:
# an active one describes the business better than a pending one, and
# both beat a rejected/withdrawn record.
MC_STATUS_RANK = {"active": 0, "pending": 1}

# Statuses that mean "this broker never actually got authority" — STEP 3
# of the pipeline spec: no lead is created for these.
MC_STATUS_SKIP = {"rejected", "withdrawn"}

# addressTypeId values, decoded by cross-checking a broker whose principal
# and mailing addresses differ (USDOT 4551039) against what its account
# page displays under each heading.
ADDRESS_TYPE_PRINCIPAL = "eef9bd53-0da3-4b96-b462-8e2711a009ef"
ADDRESS_TYPE_MAILING = "34878d0c-cf18-46ce-a23e-60bfcaf558db"

EMPTY_ADDRESS = {
    "address_line1": None,
    "address_line2": None,
    "city": None,
    "state": None,
    "zip": None,
}


def _clean(value) -> str | None:
    """MOTUS pads several fields with trailing spaces (e.g. "SCOTT ")."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _api_address(location: dict) -> dict:
    return {
        "address_line1": _clean(location.get("addressLine1")),
        "address_line2": _clean(location.get("addressLine2")),
        "city": _clean(location.get("city")),
        "state": _clean(location.get("state")),
        "zip": _clean(location.get("zipCode")),
    }


def _normalise_authority(raw_type: str | None, docket: str | None, status: str | None) -> dict:
    lowered = (raw_type or "").lower()
    if "broker" in lowered:
        # "Broker of Property (Except Household Goods)" also contains the
        # word "household" — the "except" is what distinguishes it from a
        # genuine "Broker of Household Goods" authority.
        is_hhg = "household" in lowered and "except" not in lowered
        authority_type = "household_goods" if is_hhg else "property"
    else:
        # Motor-carrier / freight-forwarder authorities on the same USDOT —
        # kept for reference but never used to pick the primary authority.
        authority_type = None
    return {
        "authority_type": authority_type,
        "raw_type": raw_type,
        "mc_number": re.sub(r"^MC[-\s]*", "", docket or "", flags=re.I).strip() or None,
        "mc_status": (status or "").strip().lower() or None,
    }


def parse_motus_payload(data: dict) -> dict:
    """Pure parser over /api/carriers/{usdot} JSON — split out from the
    request so it can be tested offline against a saved payload."""
    names = {n.get("nameType"): _clean(n.get("entityName")) for n in data.get("entityNames") or []}

    locations = data.get("locations") or []
    by_type = {loc.get("addressTypeId"): loc for loc in locations}
    principal = by_type.get(ADDRESS_TYPE_PRINCIPAL)
    mailing = by_type.get(ADDRESS_TYPE_MAILING)

    emails = data.get("emailAddresses") or []
    primary_email = next(
        (_clean(e.get("emailAddress")) for e in emails if e.get("primaryAddressFlag")),
        None,
    ) or next((_clean(e.get("emailAddress")) for e in emails), None)

    phones = data.get("phoneNumbers") or []
    phone = next((_clean(p.get("phoneNumber")) for p in phones), None)

    officials = []
    for officer in data.get("entityOfficers") or []:
        name = " ".join(
            part
            for part in (
                _clean(officer.get("firstName")),
                _clean(officer.get("middleName")),
                _clean(officer.get("lastName")),
                _clean(officer.get("suffix")),
            )
            if part
        )
        if not name:
            continue
        officials.append(
            {
                "name": name,
                "title": _clean(officer.get("title")),
                "phone": _clean(officer.get("phoneNumber")),
                "email": _clean(officer.get("email")),
            }
        )

    authorities = []
    for registration in data.get("entityRegistrations") or []:
        for link in registration.get("entityRegistrationOperatingAuthorities") or []:
            authority = link.get("entityOperatingAuthority") or {}
            authorities.append(
                _normalise_authority(
                    (authority.get("operatingAuthorityType") or {}).get("operatingAuthorityType"),
                    authority.get("docketNumber"),
                    (authority.get("operatingAuthorityStatus") or {}).get(
                        "operatingAuthorityStatusName"
                    ),
                )
            )

    broker_authorities = [a for a in authorities if a["authority_type"]]
    primary = min(
        broker_authorities,
        key=lambda a: MC_STATUS_RANK.get(a["mc_status"] or "", 2),
        default=None,
    )

    dot_status = (data.get("entityDotNumber") or {}).get("dotNumberStatus") or {}

    return {
        "usdot_status": _clean(dot_status.get("dotNumberStatus")),
        "legal_name": names.get("Legal"),
        "dba_name": names.get("DBA"),
        "principal_address": _api_address(principal) if principal else None,
        "mailing_address": _api_address(mailing) if mailing else None,
        "phone": phone,
        "email": primary_email,
        "officials": officials,
        "authorities": authorities,
        "authority_type": primary["authority_type"] if primary else None,
        "mc_number": primary["mc_number"] if primary else None,
        "mc_status": primary["mc_status"] if primary else None,
        "error": None,
    }


def motus_account_lookup(usdot: str) -> dict:
    """
    MOTUS's own JSON API, which is what the account page itself calls:
    GET https://motus.dot.gov/api/carriers/{usdot} — public, no auth.

    This replaced rendering the page in a browser and scraping its DOM.
    The page's two MUI DataGrids lazy-load — measured 8s to 20s of grey
    skeleton per broker before the officials/authority rows appeared — so
    the browser path needed a 30s worst-case wait for data this endpoint
    returns in well under a second (measured ~390ms). It is also strictly
    richer: officer phone/email come back populated here even where the
    rendered table left those cells blank, and addresses arrive already
    split into line/city/state/zip instead of needing a regex.

    Best-effort: never raises, always returns a dict
    (with "error" set on failure) so one broken lookup never kills the run.
    """
    try:
        resp = requests.get(
            MOTUS_API_URL.format(usdot=usdot),
            timeout=30,
            headers={"User-Agent": MOTUS_USER_AGENT, "Accept": "application/json"},
        )
    except Exception as e:  # noqa: BLE001
        return {**MOTUS_EMPTY_RECORD, "error": str(e)}

    if resp.status_code == 404:
        return {**MOTUS_EMPTY_RECORD, "error": "not found"}
    if resp.status_code != 200:
        return {**MOTUS_EMPTY_RECORD, "error": f"HTTP {resp.status_code}"}

    try:
        return parse_motus_payload(resp.json())
    except Exception as e:  # noqa: BLE001 — a malformed payload shouldn't kill the run
        return {**MOTUS_EMPTY_RECORD, "error": f"could not parse payload: {e}"}


# ── Step 4: Supabase save ────────────────────────────────────────────────────

def get_existing_usdots(supabase: Client) -> set[str]:
    result = supabase.table("brokers").select("dot_number").execute()
    return {row["dot_number"] for row in result.data if row["dot_number"]}


def normalise_date(raw: str | None) -> str | None:
    if not raw:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def save_broker(supabase: Client, record: dict, motus: dict, log_id: str) -> bool:
    """Returns True if a new row was inserted, False if it was a duplicate
    (dot_number already existed) and got silently skipped instead."""
    officials = motus.get("officials") or []

    # Primary contact email: the business email if MOTUS has one, otherwise
    # fall back to the first company official who listed their own.
    email = motus.get("email") or next((o["email"] for o in officials if o.get("email")), None)
    confidence = "found" if email else "not_found"

    # Company Officials table can list more than one (e.g. co-owners) —
    # keep all of them rather than just the first.
    contact_name = ", ".join(o["name"] for o in officials) if officials else record.get("officer")

    # MOTUS's structured address (principal, then mailing) comes already
    # split into line/city/state/zip. Only the PDF fallback is a single
    # string that needs the regex.
    address = (
        motus.get("principal_address")
        or motus.get("mailing_address")
        or parse_motus_address(record.get("address"))
    )

    # upsert(..., on_conflict="dot_number", ignore_duplicates=True) instead
    # of insert(): the pre-run existing-USDOT check (get_existing_usdots)
    # already skips most duplicates before we get here, but this is the
    # real guarantee — it relies on the DB's own unique constraint
    # (brokers_dot_number_key) rather than an in-memory snapshot, so
    # a duplicate row is silently ignored (not inserted, no error, no
    # crash) even if the same USDOT appears twice in one PDF, across two
    # overlapping runs, or in a future re-run.
    result = (
        supabase.table("brokers")
        .upsert(
            {
                "dot_number": record["usdot"],
                "mc_number": motus.get("mc_number"),
                "company_name": motus.get("legal_name") or record["company_name"],
                "dba_name": motus.get("dba_name"),
                "contact_name": contact_name,
                "phone": motus.get("phone") or record.get("phone"),
                "address_line1": address["address_line1"],
                "address_line2": address.get("address_line2"),
                "city": address["city"],
                "state": address["state"],
                "zip": address["zip"],
                "usdot_status": motus.get("usdot_status"),
                "mc_status": motus.get("mc_status"),
                "authority_type": motus.get("authority_type"),
                "registration_date": normalise_date(record.get("filing_date")),
                "broker_type": record["broker_type"],
                "email": email,
                "business_email": motus.get("email"),
                "email_confidence": confidence,
                "ingestion_run_id": log_id,
            },
            on_conflict="dot_number",
            ignore_duplicates=True,
        )
        .execute()
    )
    # `on_broker_inserted` DB trigger auto-creates the matching lead — only
    # fires on a real insert, so a skipped duplicate correctly gets no lead.
    if not result.data:
        return False

    save_officials(supabase, result.data[0]["id"], officials)
    return True


def save_officials(supabase: Client, broker_id: str, officials: list[dict]) -> None:
    """Best-effort — a broker row that saved fine shouldn't be lost to a
    failure writing its officials."""
    if not officials:
        return
    rows = [
        {
            "broker_id": broker_id,
            "official_name": o["name"],
            "title": o.get("title"),
            "telephone": o.get("phone"),
            "email": o.get("email"),
        }
        for o in officials
        if o.get("name")
    ]
    try:
        supabase.table("broker_officials").upsert(
            rows, on_conflict="broker_id,official_name", ignore_duplicates=True
        ).execute()
    except Exception as e:  # noqa: BLE001
        log(f"  could not save company officials: {e}")


# ── Orchestration ────────────────────────────────────────────────────────────

def main() -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("ERROR: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local")
        sys.exit(1)

    # PDF_DATE (YYYY-MM-DD, optional): which day's register to fetch from
    # motus.dot.gov. Defaults to "most recent available" when unset.
    # PDF_FILE_PATH (optional): skip discovery/download entirely and parse
    # this local PDF instead — set by the "Upload PDF" flow in the UI,
    # which runs this exact same pipeline (MOTUS enrichment +
    # Supabase save) against a manually-uploaded REGISTER PDF.
    pdf_date_str = os.environ.get("PDF_DATE")
    pdf_file_path = os.environ.get("PDF_FILE_PATH")
    run_date_str = pdf_date_str or date.today().isoformat()

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    log_row = (
        supabase.table("daily_ingestion_log")
        .insert({"run_date": run_date_str, "status": "running"})
        .execute()
    )
    log_id = log_row.data[0]["id"]

    fetched = 0
    inserted = 0
    emails_found = 0
    active_count = 0
    pending_count = 0
    skipped_status = 0

    try:
        if pdf_file_path:
            log(f"Using uploaded PDF: {pdf_file_path}")
            pdf_bytes = Path(pdf_file_path).read_bytes()
        else:
            target_date = (
                datetime.strptime(pdf_date_str, "%Y-%m-%d").date() if pdf_date_str else None
            )
            log(
                f"Looking up the FMCSA daily register for {pdf_date_str}…"
                if target_date
                else "Looking up the most recent FMCSA daily register…"
            )
            register_date, pdf_url = find_register_pdf(target_date)
            run_date_str = register_date
            log(f"Downloading the {register_date} register…")
            pdf_bytes = download_pdf(pdf_url)

        log("Parsing PDF (broker sections only — property + household goods)…")
        records = parse_pdf(pdf_bytes)

        # De-dupe within the parsed batch itself — a USDOT could in theory
        # appear twice in one PDF (e.g. listed once per an amended filing).
        # Keeps the first occurrence only.
        seen_in_batch: set[str] = set()
        deduped: list[dict] = []
        for r in records:
            if r["usdot"] in seen_in_batch:
                continue
            seen_in_batch.add(r["usdot"])
            deduped.append(r)
        if len(deduped) < len(records):
            log(f"  {len(records) - len(deduped)} duplicate USDOT rows within this PDF, collapsed")
        records = deduped

        fetched = len(records)
        log(f"Found {fetched} broker records")

        if fetched == 0:
            # FIELD_PATTERNS/SECTION_HEADERS were unverified guesses — dump
            # the raw extracted text so they can be corrected against the
            # PDF's real layout instead of guessing again.
            with pdfplumber.open(io.BytesIO(pdf_bytes)) as _pdf:
                raw_text = "\n".join(p.extract_text() or "" for p in _pdf.pages)
            debug_path = REPO_ROOT / "src" / "scripts" / "debug_pdf_text.txt"
            debug_path.write_text(raw_text, encoding="utf-8")
            log(f"  0 records — raw PDF text saved to {debug_path} ({len(raw_text)} chars)")
            has_property = SECTION_HEADERS["property"] in raw_text.upper()
            has_hhg = SECTION_HEADERS["household_goods"] in raw_text.upper()
            log(f"  section header found — property: {has_property}, household_goods: {has_hhg}")

        existing = get_existing_usdots(supabase)
        new_records = [r for r in records if r["usdot"] not in existing]
        log(f"{len(new_records)} new USDOT numbers ({fetched - len(new_records)} already processed, skipped)")

        for i, record in enumerate(new_records, 1):
            log(f"[{i}/{len(new_records)}] USDOT {record['usdot']} — {record['company_name']}")

            motus = motus_account_lookup(record["usdot"])
            if motus.get("error"):
                log(f"  MOTUS account lookup failed: {motus['error']}")
            else:
                officials = motus.get("officials") or []
                officer_str = ", ".join(o["name"] for o in officials) if officials else "—"
                log(
                    f"  email: {motus.get('email') or '—'}  officer: {officer_str}  "
                    f"MC-{motus.get('mc_number') or '—'} ({motus.get('mc_status') or 'unknown'})"
                )
                if motus.get("email"):
                    emails_found += 1
            time.sleep(MOTUS_DELAY_SECONDS)

            # STEP 3 filter: a broker whose only authority was rejected or
            # withdrawn never actually got operating authority, so there's
            # no one to sell to — don't create a lead for them.
            mc_status = motus.get("mc_status")
            if mc_status in MC_STATUS_SKIP:
                skipped_status += 1
                log(f"  skipped — MC authority is {mc_status}, no lead created")
                continue
            if mc_status == "active":
                active_count += 1
            elif mc_status == "pending":
                pending_count += 1

            was_new = save_broker(supabase, record, motus, log_id)
            if was_new:
                inserted += 1
            else:
                log(f"  skipped — USDOT {record['usdot']} already exists (duplicate)")

        supabase.table("daily_ingestion_log").update(
            {
                "status": "success",
                # The register we actually got may not be the requested
                # date (the "latest available" path picks its own).
                "run_date": run_date_str,
                "fetched_count": fetched,
                "new_count": inserted,
                "updated_count": 0,
                "active_count": active_count,
                "pending_count": pending_count,
                "skipped_count": skipped_status,
                "email_count": emails_found,
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", log_id).execute()

        log(
            f"Done — {fetched} USDOT processed · {inserted} new brokers · "
            f"{active_count} active · {pending_count} pending · "
            f"{skipped_status} rejected/withdrawn skipped · {emails_found} emails found"
        )

    except Exception as e:  # noqa: BLE001 — always record failure to the log row
        supabase.table("daily_ingestion_log").update(
            {
                "status": "error",
                "error_message": str(e),
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", log_id).execute()
        log(f"ERROR: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
