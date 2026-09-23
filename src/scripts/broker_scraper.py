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
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, quote_plus, urljoin, urlparse

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
# Polite pacing between DuckDuckGo searches (on top of SAFER_DELAY_SECONDS).
EMAIL_SEARCH_DELAY_SECONDS = 3

SECTION_HEADERS = {
    "property": "BROKER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)",
    "household_goods": "BROKER OF HOUSEHOLD GOODS",
}

EMAIL_PREFIXES = ["info", "contact", "sales"]
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")

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

def find_latest_pdf_url() -> str:
    """
    motus.dot.gov's publications page is a client-rendered app backed by a
    PRIVATE S3 bucket (motus-document-storage-prod) — confirmed unsigned
    requests return 403. Files are named predictably
    (Daily_FMCSA_Publications/REGISTER{YYYYMMDD}.pdf) but only reachable via
    a short-lived (900s) pre-signed URL, so the URL must be captured live
    from the rendered page rather than constructed.

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


# ── Step 3: Email finder ─────────────────────────────────────────────────────

def find_email(
    company_name: str, city: str | None, state: str | None, officer: str | None
) -> tuple[str | None, str]:
    """
    Best-effort. CONFIRMED against a live run: Google returns HTTP 429
    ("/sorry/index" bot-check) on essentially every request regardless of
    pacing — it detects the automated browser itself, not just request
    frequency, so it was never usable here. Switched to DuckDuckGo's
    no-JS HTML endpoint (html.duckduckgo.com/html/) via the plain Fetcher
    instead of a full browser — much less aggressive bot detection, though
    still best-effort (a high 'not_found' rate is expected regardless of
    search engine — see EMAIL_PREFIXES fallback below).
    Returns (email, confidence).
    """
    query = f"{company_name} {city or ''} {state or ''} email contact"
    search_url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"

    try:
        res = Fetcher.get(search_url)
    except Exception as e:  # noqa: BLE001
        log(f"  email search failed: {e}")
        return None, "not_found"

    if res.status != 200:
        log(f"  email search returned HTTP {res.status}")
        return None, "not_found"

    # DuckDuckGo's HTML results use class="result__a"; fall back to any
    # link on the page if that selector ever changes.
    links = res.css("a.result__a::attr(href)").getall() or res.css("a::attr(href)").getall()
    website = None
    name_tokens = [t.lower() for t in re.split(r"\W+", company_name) if len(t) > 3]

    for href in links:
        if href.startswith("//"):
            href = "https:" + href
        if "duckduckgo.com/l/" in href:
            # DDG wraps click-tracked results as /l/?uddg=<real>&... —
            # unwrap instead of discarding.
            qs = parse_qs(urlparse(href).query)
            real = qs.get("uddg", [None])[0]
            if not real:
                continue
            href = real
        elif "duckduckgo.com" in href:
            continue  # other DDG-internal links

        if not href.startswith("http"):
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

            addr = safer.get("address") or record.get("address") or ""
            parts = [p.strip() for p in addr.split(",")]
            city = parts[-2] if len(parts) >= 2 else None
            state = parts[-1] if parts else None

            time.sleep(EMAIL_SEARCH_DELAY_SECONDS)
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
