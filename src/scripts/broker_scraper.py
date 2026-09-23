"""
Broker-only lead pipeline for Broker Lead Engine.

Discovers newly-filed freight brokers (property + household goods only —
truckers/forwarders/passenger carriers are skipped) from the FMCSA daily
publication PDF, enriches each one via a SAFER lookup and a best-effort
email search, then writes new brokers to Supabase. The existing
`on_broker_inserted` DB trigger auto-creates a 'new'-stage lead for each.

RUN LOCALLY ONLY — see the architecture note in app/api/scrape/run/route.ts
for why this cannot run on Vercel (no Python runtime, no browser binary
for Scrapling's StealthyFetcher, and FMCSA/Google both block cloud IPs).

Usage:
    pip install -r src/scripts/requirements.txt
    python src/scripts/broker_scraper.py

Reads Supabase credentials from the repo's .env.local (same variables the
Next.js app uses: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) so
there is only one place secrets live.

UNVERIFIED AGAINST LIVE SITES — motus.dot.gov and safer.fmcsa.dot.gov were
not reachable during development (same cloud-IP blocking pattern this
project hit earlier with census.dot.gov and QCMobile). The PDF-field
regexes, SAFER selectors, and page-link discovery below are best-effort
guesses at FMCSA's actual format. After your first real run, inspect a
downloaded PDF/page and adjust FIELD_PATTERNS / safer_lookup() as needed —
each function has a fallback that logs and continues rather than crashing
the whole run on one bad record.
"""

import io
import os
import re
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import quote_plus, urljoin, urlparse

import pdfplumber
import requests
from dotenv import load_dotenv
from scrapling.fetchers import Fetcher, StealthyFetcher
from supabase import Client, create_client

# ── Config ───────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env.local")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

MOTUS_INDEX_URL = "https://motus.dot.gov/customer/daily-fmcsa-publications"
SAFER_SNAPSHOT_URL = "https://safer.fmcsa.dot.gov/CompanySnapshot.aspx?USDOT={usdot}"
SAFER_DELAY_SECONDS = 2

SECTION_HEADERS = {
    "property": "BROKER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)",
    "household_goods": "BROKER OF HOUSEHOLD GOODS",
}

EMAIL_PREFIXES = ["info", "contact", "sales"]
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")

FIELD_PATTERNS = {
    "usdot": re.compile(r"USDOT Number[:\s]+(\d+)", re.I),
    "legal_name": re.compile(r"Legal Business Name[:\s]+(.+)", re.I),
    "filing_date": re.compile(r"Filing Date[:\s]+([\d/\-]+)", re.I),
    "address": re.compile(r"Business Mailing Address[:\s]+(.+)", re.I),
    "officer": re.compile(r"Company Officer[:\s]+(.+)", re.I),
    "phone": re.compile(r"Business Telephone[:\s]+([\d\-() ]+)", re.I),
}


def log(msg: str) -> None:
    """Progress line — the Next.js API route streams stdout verbatim."""
    print(f"[scraper] {msg}", flush=True)


# ── Step 1: PDF discovery + parsing ─────────────────────────────────────────

def find_latest_pdf_url() -> str:
    res = Fetcher.get(MOTUS_INDEX_URL)
    if res.status != 200:
        raise RuntimeError(f"Failed to load {MOTUS_INDEX_URL}: HTTP {res.status}")

    # Primary guess: a direct <a href="....pdf"> link
    pdf_links = res.css("a[href$='.pdf']::attr(href)").getall()

    # Fallback: some FMCSA pages serve PDFs via a download/redirect endpoint
    # without a literal ".pdf" in the href (e.g. "?file=..." or "/download/").
    # Loosely match anchor text or href containing "pdf"/"daily"/"publication".
    if not pdf_links:
        all_links = res.css("a::attr(href)").getall()
        pdf_links = [
            href for href in all_links
            if href and ("pdf" in href.lower() or "download" in href.lower())
        ]

    if not pdf_links:
        # Couldn't find anything — dump every link on the page so the real
        # structure can be inspected instead of guessing again blind.
        all_links = res.css("a::attr(href)").getall()
        sample = "\n".join(f"  {h}" for h in all_links[:60])
        raise RuntimeError(
            "No PDF links found on the motus.dot.gov publications page. "
            f"Found {len(all_links)} total links on the page; first 60:\n{sample}\n"
            "The page likely needs JS to render the download link, or uses a "
            "different pattern than 'pdf'/'download' in the href — share this "
            "list to fix find_latest_pdf_url()."
        )
    return urljoin(MOTUS_INDEX_URL, pdf_links[0])


def download_pdf(url: str) -> bytes:
    resp = requests.get(url, timeout=60, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    return resp.content


def parse_broker_block(block: str, broker_type: str) -> dict | None:
    def extract(pattern: re.Pattern) -> str | None:
        m = pattern.search(block)
        return m.group(1).strip() if m else None

    usdot = extract(FIELD_PATTERNS["usdot"])
    legal_name = extract(FIELD_PATTERNS["legal_name"])
    if not usdot or not legal_name:
        return None

    return {
        "usdot": usdot,
        "company_name": legal_name,
        "filing_date": extract(FIELD_PATTERNS["filing_date"]),
        "address": extract(FIELD_PATTERNS["address"]),
        "officer": extract(FIELD_PATTERNS["officer"]),
        "phone": extract(FIELD_PATTERNS["phone"]),
        "broker_type": broker_type,
    }


def parse_pdf(pdf_bytes: bytes) -> list[dict]:
    """Extracts broker records from the two target sections only."""
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        full_text = "\n".join(page.extract_text() or "" for page in pdf.pages)

    records: list[dict] = []
    current_section: str | None = None
    buffer: list[str] = []

    def flush_buffer() -> None:
        nonlocal buffer
        if buffer and current_section:
            record = parse_broker_block("\n".join(buffer), current_section)
            if record:
                records.append(record)
        buffer = []

    for line in full_text.split("\n"):
        stripped = line.strip().upper()

        if SECTION_HEADERS["property"] in stripped:
            flush_buffer()
            current_section = "property"
            continue
        if SECTION_HEADERS["household_goods"] in stripped:
            flush_buffer()
            current_section = "household_goods"
            continue
        # Any other all-caps section header (truckers, forwarders, passenger
        # carriers, ...) ends our section until a broker header appears again
        if stripped.isupper() and len(stripped) > 15 and "BROKER" not in stripped and current_section:
            flush_buffer()
            current_section = None
            continue

        if current_section:
            buffer.append(line)
            if not line.strip() and any("USDOT" in b.upper() for b in buffer):
                flush_buffer()

    flush_buffer()
    return records


# ── Step 2: SAFER lookup ─────────────────────────────────────────────────────

def safer_lookup(usdot: str) -> dict:
    url = SAFER_SNAPSHOT_URL.format(usdot=usdot)
    try:
        res = Fetcher.get(url)
    except Exception as e:  # noqa: BLE001 — best-effort, never fatal to the run
        return {"mc_number": None, "operating_status": None, "address": None, "error": str(e)}

    if res.status != 200:
        return {"mc_number": None, "operating_status": None, "address": None, "error": f"HTTP {res.status}"}

    text = res.get_all_text()

    mc_match = re.search(r"MC[/\-]MX[\-\s]*(?:Number)?[:\s]*(\d+)", text, re.I)
    status_match = re.search(r"Operating Status[:\s]*([A-Z\- ]+)", text, re.I)
    address_match = re.search(r"Physical Address[:\s]*(.+)", text, re.I)

    return {
        "mc_number": mc_match.group(1) if mc_match else None,
        "operating_status": status_match.group(1).strip() if status_match else None,
        "address": address_match.group(1).strip() if address_match else None,
        "error": None,
    }


# ── Step 3: Email finder ─────────────────────────────────────────────────────

def find_email(
    company_name: str, city: str | None, state: str | None, officer: str | None
) -> tuple[str | None, str]:
    """
    Best-effort. Google aggressively blocks/CAPTCHAs automated search
    traffic, so a high 'not_found' rate is expected even with Scrapling's
    stealth fetcher — this is the weakest link in the pipeline by design.
    Returns (email, confidence).
    """
    query = f"{company_name} {city or ''} {state or ''} email contact"
    search_url = f"https://www.google.com/search?q={quote_plus(query)}"

    try:
        res = StealthyFetcher.fetch(search_url, headless=True, network_idle=True)
    except Exception as e:  # noqa: BLE001
        log(f"  email search failed: {e}")
        return None, "not_found"

    links = res.css("a::attr(href)").getall()
    website = None
    name_tokens = [t.lower() for t in re.split(r"\W+", company_name) if len(t) > 3]

    for href in links:
        if not href.startswith("http") or "google.com" in href:
            continue
        domain = urlparse(href).netloc.lower()
        if any(tok in domain for tok in name_tokens):
            website = href
            break

    if not website:
        return None, "not_found"

    try:
        site_res = StealthyFetcher.fetch(website, headless=True, network_idle=True)
    except Exception as e:  # noqa: BLE001
        log(f"  website crawl failed: {e}")
        return None, "not_found"

    found_emails = set(EMAIL_RE.findall(site_res.get_all_text()))
    if not found_emails:
        return None, "not_found"

    domain = urlparse(website).netloc.replace("www.", "")
    lower_emails = {e.lower(): e for e in found_emails}

    if officer:
        first = officer.strip().split()[0].lower()
        for lower, original in lower_emails.items():
            if lower.startswith(first + "@"):
                return original, "found"

    for prefix in EMAIL_PREFIXES:
        guess = f"{prefix}@{domain}"
        if guess in lower_emails:
            return lower_emails[guess], "found"

    return next(iter(found_emails)), "guessed"


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


def save_broker(
    supabase: Client, record: dict, safer: dict, email: str | None, confidence: str, log_id: str
) -> None:
    supabase.table("brokers").insert(
        {
            "dot_number": record["usdot"],
            "mc_number": safer.get("mc_number"),
            "company_name": record["company_name"],
            "contact_name": record.get("officer"),
            "phone": record.get("phone"),
            "address_line1": safer.get("address") or record.get("address"),
            "authority_status": safer.get("operating_status"),
            "registration_date": normalise_date(record.get("filing_date")),
            "broker_type": record["broker_type"],
            "email": email,
            "email_confidence": confidence,
            "ingestion_run_id": log_id,
        }
    ).execute()
    # `on_broker_inserted` DB trigger auto-creates the matching lead


# ── Orchestration ────────────────────────────────────────────────────────────

def main() -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("ERROR: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local")
        sys.exit(1)

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    log_row = (
        supabase.table("daily_ingestion_log")
        .insert({"run_date": date.today().isoformat(), "status": "running"})
        .execute()
    )
    log_id = log_row.data[0]["id"]

    fetched = 0
    inserted = 0
    emails_found = 0

    try:
        log("Fetching latest FMCSA daily publication index…")
        pdf_url = find_latest_pdf_url()
        log(f"Downloading {pdf_url}")
        pdf_bytes = download_pdf(pdf_url)

        log("Parsing PDF (broker sections only — property + household goods)…")
        records = parse_pdf(pdf_bytes)
        fetched = len(records)
        log(f"Found {fetched} broker records")

        existing = get_existing_usdots(supabase)
        new_records = [r for r in records if r["usdot"] not in existing]
        log(f"{len(new_records)} new USDOT numbers ({fetched - len(new_records)} already processed, skipped)")

        for i, record in enumerate(new_records, 1):
            log(f"[{i}/{len(new_records)}] USDOT {record['usdot']} — {record['company_name']}")

            safer = safer_lookup(record["usdot"])
            if safer.get("error"):
                log(f"  SAFER lookup failed: {safer['error']}")
            time.sleep(SAFER_DELAY_SECONDS)

            addr = safer.get("address") or record.get("address") or ""
            parts = [p.strip() for p in addr.split(",")]
            city = parts[-2] if len(parts) >= 2 else None
            state = parts[-1] if parts else None

            email, confidence = find_email(record["company_name"], city, state, record.get("officer"))
            if confidence == "found":
                emails_found += 1
            log(f"  email: {email or '—'} ({confidence})")

            save_broker(supabase, record, safer, email, confidence, log_id)
            inserted += 1

        supabase.table("daily_ingestion_log").update(
            {
                "status": "success",
                "fetched_count": fetched,
                "new_count": inserted,
                "updated_count": 0,
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", log_id).execute()

        log(f"Done — {inserted} new brokers inserted, {emails_found} emails found ({fetched} fetched)")

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
