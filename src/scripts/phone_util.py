"""E.164 normalisation for the Python writers, mirroring lib/phone.ts.

Same rules as the app: default country US, "00" means "+", tel:/labels are
tolerated, only a *valid* number is returned (a short or fake one gives None),
and an extension is dropped from the number.
"""

from __future__ import annotations

import re
import unicodedata

try:
    import phonenumbers
except ImportError:  # keep the scraper running; phone_e164 just stays empty
    phonenumbers = None

DEFAULT_REGION = "US"
_SPACES = re.compile("[   -​  ⁠　﻿]")
_DASHES = re.compile("[‐-―−﹘﹣－]")


def _clean(raw: str) -> str:
    text = unicodedata.normalize("NFKC", raw)
    text = _SPACES.sub(" ", text)
    text = _DASHES.sub("-", text)
    text = re.sub(r"^\s*tel:", "", text, flags=re.I).strip()
    return re.sub(r"^00(?=\d)", "+", text)


def to_e164(raw: str | None) -> str | None:
    """"(214) 370-8737 ext 12" -> "+12143708737"; None if not a valid number."""
    if not raw or phonenumbers is None:
        return None
    text = _clean(str(raw))
    if not text:
        return None
    try:
        num = phonenumbers.parse(text, DEFAULT_REGION)
        if phonenumbers.is_valid_number(num):
            return phonenumbers.format_number(num, phonenumbers.PhoneNumberFormat.E164)
    except phonenumbers.NumberParseException:
        pass
    # Labels / several numbers in one string: first valid number in the text.
    for match in phonenumbers.PhoneNumberMatcher(text, DEFAULT_REGION):
        if phonenumbers.is_valid_number(match.number):
            return phonenumbers.format_number(match.number, phonenumbers.PhoneNumberFormat.E164)
    return None
