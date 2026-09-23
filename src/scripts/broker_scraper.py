"""
Broker-only lead pipeline for Broker Lead Engine.

Discovers newly-filed freight brokers (property + household goods only —
truckers/forwarders/passenger carriers are skipped) from the FMCSA daily
publication PDF, enriches each one via a SAFER lookup, then writes new
brokers to Supabase. The existing `on_broker_inserted` DB trigger
auto-creates a 'new'-stage lead for each.

STATUS (verified against real runs, 2026-09-23):
  - PDF discovery + download: WORKING (captures the live pre-signed S3
    URL via browser automation — see find_latest_pdf_url()).
  - PDF parsing: WORKING — verified 33/33 property-broker rows parsed
    correctly from a real REGISTER PDF.
  - SAFER enrichment: WORKING.
  - MOTUS account lookup (email + officials + address): WORKING.
    https://motus.dot.gov/customer/{usdot}/account is a PUBLIC (no
    login required) per-USDOT record page — confirmed via a live test
    that it returns Business Email, Company Officials (name + title,
    i.e. the CEO/beneficial-owner/contact person), Principal Place of
    Business, Mailing Address, and Business Telephone directly. This
    replaces the old Google/DuckDuckGo email-search approach entirely
    — see motus_account_lookup().
  - Email discovery via search engines: REMOVED. Both Google (429
    "/sorry/index") and DuckDuckGo (image CAPTCHA) blocked automated
    search outright, confirmed from this sandbox AND the operator's
    own residential IP — the MOTUS account page (above) makes this
    unnecessary anyway, so the search-engine code was deleted rather
    than kept unused. If MOTUS ever gets locked down, a paid provider
    (Hunter.io, SerpAPI, ...) would need wiring in here instead.

RUN LOCALLY ONLY — see the architecture note in app/api/scrape/run/route.ts
for why this cannot run on Vercel (no Python runtime, no browser binary
for Scrapling's StealthyFetcher, and FMCSA blocks cloud IPs).

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
from scrapling.fetchers import Fetcher, StealthyFetcher
from supabase import Client, create_client

# ── Config ───────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env.local")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

MOTUS_INDEX_URL = "https://motus.dot.gov/customer/daily-fmcsa-publications"
MOTUS_ACCOUNT_URL = "https://motus.dot.gov/customer/{usdot}/account"
SAFER_SNAPSHOT_URL = "https://safer.fmcsa.dot.gov/CompanySnapshot.aspx?USDOT={usdot}"
SAFER_DELAY_SECONDS = 2
MOTUS_DELAY_SECONDS = 2

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
# address/officer are left to the SAFER enrichment step rather than
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

def find_latest_pdf_url(target_date: "date | None" = None) -> str:
    """
    motus.dot.gov's publications page is a client-rendered app backed by a
    PRIVATE S3 bucket (motus-document-storage-prod) — confirmed unsigned
    requests return 403. Files are named predictably
    (Daily_FMCSA_Publications/REGISTER{YYYYMMDD}.pdf) but only reachable via
    a short-lived (900s) pre-signed URL, so the URL must be captured live
    from the rendered page rather than constructed.

    If target_date is given, the From/To range is narrowed to that single
    day so the specific day's register is picked (rather than "whatever is
    most recent"). Otherwise defaults to the last 7 days, picking the most
    recent one available.

    Strategy, in order:
      (a) the pre-signed href might already be in the DOM once JS renders —
          scan all links for the REGISTER filename pattern.
      (b) otherwise, click the most recent date link under "FMCSA Daily
          Register" and capture the resulting network request's URL.
    """
    import re as _re

    captured: dict[str, str] = {}

    def page_action(page):
        page.wait_for_load_state("networkidle")

        # This is a Material-UI React form: a document-type CHECKBOX
        # ("FMCSA Daily Register"), a From/To date range, and an Apply
        # button. The From/To inputs came back empty (value="") in this
        # automated session — unlike a real browser, nothing auto-fills a
        # default range here, so Apply was submitting an empty date range
        # and getting nothing back. Fill both dates explicitly (8-day max
        # window per the page's own note) before checking the box and
        # clicking Apply.
        if target_date is not None:
            from_date = to_date = target_date.strftime("%m/%d/%Y")
        else:
            today = date.today()
            from_date = (today - timedelta(days=7)).strftime("%m/%d/%Y")
            to_date = today.strftime("%m/%d/%Y")

        try:
            date_inputs = page.locator("input[placeholder='MM/DD/YYYY']")
            date_inputs.nth(0).fill(from_date, timeout=5000)
            date_inputs.nth(1).fill(to_date, timeout=5000)
            log(f"  set date range {from_date} → {to_date}")
        except Exception as e:  # noqa: BLE001
            log(f"  could not fill date range: {e}")

        try:
            page.locator("label:has-text('FMCSA Daily Register')").first.click(timeout=5000)
            log("  checked 'FMCSA Daily Register' checkbox")
        except Exception as e:  # noqa: BLE001
            log(f"  could not check the document-type checkbox: {e}")

        try:
            page.locator("button:has-text('Apply')").first.click(timeout=5000)
            log("  clicked Apply button")
        except Exception as e:  # noqa: BLE001 — proceed with whatever is already rendered
            log(f"  could not click Apply button: {e}")

        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(5000)

        # (a) the pre-signed href might already be in the DOM once JS renders
        for el in page.locator("a").all():
            href = el.get_attribute("href") or ""
            if "REGISTER" in href and ".pdf" in href:
                captured["url"] = href
                return page

        # (b) find clickable-looking elements whose visible text is a bare
        # date (MM/DD/YYYY). Matching is done in Python (not via Playwright's
        # own regex locators — patchright's regex-to-selector conversion
        # chokes on "\d" patterns) to sidestep that entirely.
        date_re = _re.compile(r"^\d{2}/\d{2}/\d{4}$")
        candidates = []
        for el in page.locator("a, button, span, div").all():
            try:
                text = el.inner_text().strip()
            except Exception:  # noqa: BLE001
                continue
            if date_re.match(text):
                candidates.append(el)

        # The "FMCSA Daily Register" section's links appear first in the
        # DOM, so try the last date-text element first and walk backwards.
        for el in reversed(candidates):
            try:
                with page.expect_response(
                    lambda r: "REGISTER" in r.url and ".pdf" in r.url, timeout=8000
                ) as resp_info:
                    el.click()
                captured["url"] = resp_info.value.url
                return page
            except Exception:  # noqa: BLE001 — try the next candidate
                continue

        # Nothing matched — dump HTML around the first real date pattern
        # found anywhere in the page (not the word "Daily Register", which
        # only ever appears once, as the checkbox label) to a local file.
        try:
            full_html = page.content()
            debug_path = REPO_ROOT / "src" / "scripts" / "debug_page.html"
            debug_path.write_text(full_html, encoding="utf-8")
            captured["debug_path"] = str(debug_path)

            date_match = _re.search(r"\d{2}/\d{2}/202\d", full_html)
            if date_match:
                idx = date_match.start()
                captured["debug_snippet"] = full_html[max(0, idx - 500): idx + 1000]
                captured["debug_note"] = f"Found date text at offset {idx}"
            else:
                captured["debug_snippet"] = full_html[:2000]
                captured["debug_note"] = "No MM/DD/YYYY-shaped text found anywhere in the rendered page"
        except Exception:  # noqa: BLE001
            pass

        return page

    res = StealthyFetcher.fetch(
        MOTUS_INDEX_URL, headless=True, network_idle=True, page_action=page_action
    )
    if res.status != 200:
        raise RuntimeError(f"Failed to load {MOTUS_INDEX_URL}: HTTP {res.status}")

    if "url" in captured:
        return captured["url"]

    if "debug_snippet" in captured:
        raise RuntimeError(
            "Could not find or trigger the FMCSA Daily Register PDF link. "
            f"{captured.get('debug_note', '')} Full page HTML saved to "
            f"{captured['debug_path']} — share the snippet below (or that "
            f"file) to fix this:\n{captured['debug_snippet']}"
        )

    all_links = res.css("a::attr(href)").getall()
    sample = "\n".join(f"  {h}" for h in all_links[:60])
    raise RuntimeError(
        "Could not find or trigger the FMCSA Daily Register PDF link. "
        f"Links on page after render:\n{sample}\n"
        "Share this output to adjust find_latest_pdf_url()."
    )


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
                    # extraction) — left for the SAFER enrichment step.
                    "address": None,
                    "officer": None,
                    "phone": phone_match.group(1).strip() if phone_match else None,
                    "broker_type": current_section,
                })

        i += 1

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


def motus_account_lookup(usdot: str) -> dict:
    """
    https://motus.dot.gov/customer/{usdot}/account is a PUBLIC, no-login
    per-USDOT record page — CONFIRMED via a live test that it returns the
    full business record directly: Legal Business Name, Principal Place of
    Business, Mailing Address, Business Telephone, Business Email, and a
    COMPANY OFFICIALS table (name + title — the CEO / beneficial owner /
    contact person). This is a client-rendered MUI app like the daily
    publications page, so it needs StealthyFetcher (a real browser), not
    the plain Fetcher.

    Best-effort like safer_lookup(): never raises, always returns a dict
    (with "error" set on failure) so one broken lookup never kills the run.

    NOTE on officials parsing: the page renders as plain stacked text with
    no reliable column markers, so officials are read as alternating
    Name/Title line pairs after the "COMPANY OFFICIALS" header block. If an
    official also has a phone/email filled in, the pairing can drift for
    that row — acceptable here since the primary goal (name of the top
    officer, i.e. the CEO/contact) is the first pair, which is reliable.
    """
    url = MOTUS_ACCOUNT_URL.format(usdot=usdot)
    empty = {
        "legal_name": None,
        "principal_address": None,
        "mailing_address": None,
        "phone": None,
        "email": None,
        "officials": [],
        "error": None,
    }

    try:
        res = StealthyFetcher.fetch(url, headless=True, network_idle=True)
    except Exception as e:  # noqa: BLE001
        return {**empty, "error": str(e)}

    if res.status != 200:
        return {**empty, "error": f"HTTP {res.status}"}

    text = res.get_all_text()
    if "Entity not found" in text:
        return {**empty, "error": "not found"}

    lines = [l.strip() for l in text.split("\n") if l.strip()]

    def value_after(label: str) -> str | None:
        try:
            idx = lines.index(label)
        except ValueError:
            return None
        return lines[idx + 1] if idx + 1 < len(lines) else None

    legal_name = value_after("Legal Business Name")
    principal_address = value_after("Principal Place of Business")
    mailing_address = value_after("Mailing Address")
    phone = value_after("Business Telephone No.")
    email = value_after("Business Email")

    officials: list[dict] = []
    if "COMPANY OFFICIALS" in lines:
        start = lines.index("COMPANY OFFICIALS")
        header_labels = {"Official Name", "Title", "Telephone No", "Email"}
        j = start + 1
        while j < len(lines) and lines[j] in header_labels:
            j += 1
        stop_markers = ("Rows per page", "MILEAGE INFORMATION", "OPERATION DETAILS")
        while j + 1 < len(lines):
            name, title = lines[j], lines[j + 1]
            if name.startswith(stop_markers) or "of 2" in name or " of " in name.lower():
                break
            officials.append({"name": name, "title": title})
            j += 2

    return {
        "legal_name": legal_name,
        "principal_address": principal_address,
        "mailing_address": mailing_address,
        "phone": phone,
        "email": email,
        "officials": officials,
        "error": None,
    }


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
    supabase: Client, record: dict, safer: dict, motus: dict, log_id: str
) -> bool:
    """Returns True if a new row was inserted, False if it was a duplicate
    (dot_number already existed) and got silently skipped instead."""
    email = motus.get("email")
    confidence = "found" if email else "not_found"

    officials = motus.get("officials") or []
    # Company Officials table can list more than one (e.g. co-owners) —
    # keep all of them rather than just the first.
    contact_name = ", ".join(o["name"] for o in officials) if officials else record.get("officer")

    # Prefer the confirmed MOTUS address (principal, then mailing) over the
    # SAFER snapshot address, over whatever the PDF row itself had.
    raw_address = (
        motus.get("principal_address")
        or motus.get("mailing_address")
        or safer.get("address")
        or record.get("address")
    )
    address = parse_motus_address(raw_address)

    # upsert(..., on_conflict="dot_number", ignore_duplicates=True) instead
    # of insert(): the pre-run existing-USDOT check (get_existing_usdots)
    # already skips most duplicates before we get here, but this is the
    # real guarantee — it relies on the DB's own unique index
    # (brokers_dot_number_unique_idx) rather than an in-memory snapshot, so
    # a duplicate row is silently ignored (not inserted, no error, no
    # crash) even if the same USDOT appears twice in one PDF, across two
    # overlapping runs, or in a future re-run.
    result = (
        supabase.table("brokers")
        .upsert(
            {
                "dot_number": record["usdot"],
                "mc_number": safer.get("mc_number"),
                "company_name": motus.get("legal_name") or record["company_name"],
                "contact_name": contact_name,
                "phone": motus.get("phone") or record.get("phone"),
                "address_line1": address["address_line1"],
                "city": address["city"],
                "state": address["state"],
                "zip": address["zip"],
                "authority_status": safer.get("operating_status"),
                "registration_date": normalise_date(record.get("filing_date")),
                "broker_type": record["broker_type"],
                "email": email,
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
    return len(result.data) > 0


# ── Orchestration ────────────────────────────────────────────────────────────

def main() -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("ERROR: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local")
        sys.exit(1)

    # PDF_DATE (YYYY-MM-DD, optional): which day's register to fetch from
    # motus.dot.gov. Defaults to "most recent available" when unset.
    # PDF_FILE_PATH (optional): skip discovery/download entirely and parse
    # this local PDF instead — set by the "Upload PDF" flow in the UI,
    # which runs this exact same pipeline (SAFER + MOTUS enrichment +
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

    try:
        if pdf_file_path:
            log(f"Using uploaded PDF: {pdf_file_path}")
            pdf_bytes = Path(pdf_file_path).read_bytes()
        else:
            target_date = (
                datetime.strptime(pdf_date_str, "%Y-%m-%d").date() if pdf_date_str else None
            )
            log(
                f"Fetching FMCSA daily publication for {pdf_date_str}…"
                if target_date
                else "Fetching latest FMCSA daily publication index…"
            )
            pdf_url = find_latest_pdf_url(target_date)
            log(f"Downloading {pdf_url}")
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

            safer = safer_lookup(record["usdot"])
            if safer.get("error"):
                log(f"  SAFER lookup failed: {safer['error']}")
            time.sleep(SAFER_DELAY_SECONDS)

            motus = motus_account_lookup(record["usdot"])
            if motus.get("error"):
                log(f"  MOTUS account lookup failed: {motus['error']}")
            else:
                officials = motus.get("officials") or []
                officer_str = officials[0]["name"] if officials else "—"
                log(f"  email: {motus.get('email') or '—'}  officer: {officer_str}")
                if motus.get("email"):
                    emails_found += 1
            time.sleep(MOTUS_DELAY_SECONDS)

            was_new = save_broker(supabase, record, safer, motus, log_id)
            if was_new:
                inserted += 1
            else:
                log(f"  skipped — USDOT {record['usdot']} already exists (duplicate)")

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
