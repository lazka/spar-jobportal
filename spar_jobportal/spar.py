"""Read the public SPAR jobs API and job detail pages."""

from __future__ import annotations

import json
import re
import sys
import urllib.parse
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any

from .http_client import PoliteOpener
from .storage import as_object, clean_text

SEARCH_PAGE = "https://jobs.spar.at/de_DE/SparCareers/offene-stellen"
LIST_ENDPOINT = "https://jobs.spar.at/45/_portalList"
MAX_PAGE_SIZE = 50
DETAIL_URL = "https://jobs.spar.at/de_DE/SparCareers/job-detail/"

FIELD_KEYS = {
    "Organisationseinheit": "organizationUnit",
    "Name": "title",
    "Bundesland (Filter Website)": "state",
    "Dienstort": "location",
    "Berufsfeld": "jobField",
    "Beschäftigungsausmaß": "employmentType",
    "Eintritt zum": "start",
    "Schnellbewerbung (ohne Lebenslauf)": "quickApplyWithoutCV",
}


class SearchListConfigParser(HTMLParser):
    """Read only the search widget's bootstrap configuration, not job-page data."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.config: dict[str, Any] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "list":
            return
        values = dict(attrs)
        if values.get("data-widgetid") != "searchJobsList":
            return
        raw = values.get("data-props")
        if raw:
            self.config = json.loads(raw)


def bootstrap(opener: PoliteOpener) -> tuple[dict[str, Any], str]:
    response, body = opener.get(SEARCH_PAGE, "text/html,application/xhtml+xml")
    html = body.decode(response.headers.get_content_charset() or "utf-8", "replace")
    parser = SearchListConfigParser()
    parser.feed(html)
    config = parser.config
    if not config:
        raise RuntimeError("Search widget configuration was not found on the public jobs page.")
    required = ("uuid", "qtvc", "links", "formId", "searchIndexId", "listType")
    missing = [key for key in required if not config.get(key)]
    if missing:
        raise RuntimeError(f"Search widget configuration is missing: {', '.join(missing)}")
    return config, response.url


def api_params(config: dict[str, Any], offset: int, page_size: int) -> dict[str, str]:
    def bool_text(value: Any) -> str:
        return "true" if value else "false"

    return {
        "allowFilteringFromUrlParams": bool_text(config.get("allowFilteringFromUrlParams")),
        "allowListSorting": bool_text(config.get("allowListSorting")),
        "dynamicValueConfigs": json.dumps(
            config.get("dynamicValueConfigs", []), separators=(",", ":")
        ),
        "fetchJobIdInPeopleLists": bool_text(config.get("fetchJobIdInPeopleLists", True)),
        "filters": json.dumps({"search": ""}, separators=(",", ":")),
        "hasToIncludePaginationOptions": bool_text(config.get("hasToIncludePaginationOptions")),
        "layout": str(config.get("layout", "custom")),
        "listType": str(config["listType"]),
        "offset": str(offset),
        "pageUrlParams": "{}",
        "qtvc": str(config["qtvc"]),
        "recordsPerPage": str(page_size),
        "searchMode": str(config.get("searchMode", "ResultsAndCount")),
        "shouldAddBase64FileFields": bool_text(config.get("shouldAddBase64FileFields")),
        "sort": "",
        "sortDirection": "DESC",
        "token": "",
        "uuid": str(config["uuid"]),
        "links": json.dumps(config["links"], separators=(",", ":")),
        "formId": str(config["formId"]),
        "searchIndexId": str(config["searchIndexId"]),
    }


def fetch_page(
    opener: PoliteOpener,
    config: dict[str, Any],
    search_page: str,
    offset: int,
    page_size: int,
) -> dict[str, Any]:
    url = LIST_ENDPOINT + "?" + urllib.parse.urlencode(api_params(config, offset, page_size))
    headers = {
        "Referer": search_page,
        "Origin": "https://jobs.spar.at",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
    }
    _, body = opener.get(url, "application/json, text/plain, */*", headers)
    data = json.loads(body)
    if not isinstance(data, dict) or not isinstance(data.get("results"), list):
        raise RuntimeError(f"Unexpected JSON response for offset {offset}.")
    if data.get("isFiltered"):
        raise RuntimeError("The portal returned a filtered list; refusing to label it as all jobs.")
    return data


def safe_links(links: dict[str, Any]) -> dict[str, Any]:
    """Drop short-lived qtvc query tokens from returned job URLs."""
    cleaned = {}
    for key, value in links.items():
        if not isinstance(value, str):
            cleaned[key] = value
            continue
        parsed = urllib.parse.urlsplit(value)
        query = [
            (name, val)
            for name, val in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
            if name.lower() != "qtvc"
        ]
        cleaned[key] = urllib.parse.urlunsplit(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                urllib.parse.urlencode(query),
                parsed.fragment,
            )
        )
    return cleaned


def convert_job(
    record: dict[str, Any], links: dict[str, Any], columns: dict[str, str]
) -> dict[str, Any]:
    fields = as_object(record.get("fields"))
    values = {}
    unit_id = None
    for code, field in fields.items():
        key = FIELD_KEYS.get(columns.get(code))
        if key is None:
            continue
        field = as_object(field)
        raw = as_object(field.get("jsonValue")).get("value")
        value = field.get("stringValue")
        if value in ("", None):
            value = raw
        values[key] = (value.strip() or None) if isinstance(value, str) else value
        if key == "organizationUnit":
            option = as_object(as_object(raw).get("value"))
            unit_id = option.get("id")
            values[key] = option.get("name") if isinstance(value, dict) else values[key]

    job = {"id": record["id"]}
    job.update({key: values.get(key) for key in FIELD_KEYS.values() if key != "organizationUnit"})
    if not isinstance(job["title"], str) or not job["title"]:
        raise ValueError(f"SPAR did not return a title for job {job['id']}.")
    if job["quickApplyWithoutCV"] == "Nein":
        job["quickApplyWithoutCV"] = False
    job["detailUrl"] = links.get("detailPage")
    job["applicationUrl"] = links.get("applyPage")
    job["unit"] = {"id": unit_id, "name": values.get("organizationUnit")}
    return job


class RepeatedJobError(ValueError):
    """The same job appeared more than once during pagination."""


def fetch_jobs(opener: PoliteOpener) -> list[dict[str, Any]]:
    config, search_page = bootstrap(opener)
    jobs: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    columns: dict[str, str] = {}
    reported_total = None
    lower_bound = None
    limit_flag = False
    offset = 0
    while True:
        data = fetch_page(opener, config, search_page, offset, MAX_PAGE_SIZE)
        if data.get("columns"):
            columns = {column["code"]: column["label"] for column in data["columns"]}
        if data.get("total") is not None:
            total = str(data["total"])
            if total.endswith("+") and total[:-1].isdecimal():
                lower_bound = max(lower_bound or 0, int(total[:-1]) + 1)
            elif total.isdecimal() and reported_total in (None, int(total)):
                reported_total = int(total)
            else:
                raise ValueError(
                    "SPAR's reported job count is invalid or changed during the update. Try again."
                )
        limit_flag |= bool(data.get("totalLimitReached"))
        records = data["results"]
        links = data.get("links") or []
        if records and not {"Name", "Organisationseinheit"} <= set(columns.values()):
            raise ValueError("SPAR's response is missing the title or organization-unit column.")
        for index, record in enumerate(records):
            job_id = as_object(record).get("id")
            if not str(job_id).isdecimal():
                raise ValueError(f"Invalid job ID {job_id} at offset {offset}.")
            if str(job_id) in seen_ids:
                raise RepeatedJobError(
                    f"Repeated job ID {job_id} at offset {offset}; refusing to save an incomplete jobs snapshot."
                )
            seen_ids.add(str(job_id))
            job_links = as_object(links[index]) if index < len(links) else {}
            jobs.append(convert_job(record, safe_links(job_links), columns))

        next_offsets = [
            control.get("value")
            for control in data.get("navigationControls", [])
            if control.get("linkType") == "paginationNextLink"
        ]
        if not next_offsets:
            break
        if (
            len(next_offsets) != 1
            or not str(next_offsets[0]).isdecimal()
            or int(next_offsets[0]) <= offset
        ):
            raise ValueError(f"Invalid next page at offset {offset}.")
        next_offset = int(next_offsets[0])
        if not records or next_offset != offset + len(records):
            raise ValueError(f"SPAR pagination skipped records at offset {offset}.")
        offset = next_offset

    if reported_total is None:
        raise ValueError(
            f"SPAR did not confirm the total after {len(jobs)} jobs; leaving the dataset unchanged."
        )
    if len(jobs) != reported_total:
        raise ValueError(
            f"SPAR reported {reported_total} jobs but returned {len(jobs)}; leaving the dataset unchanged."
        )
    if lower_bound is not None and len(jobs) < lower_bound:
        raise ValueError("SPAR's job count contradicted its reported lower bound. Try again.")
    if limit_flag:
        print(
            f"SPAR flagged a search limit; all {len(jobs)} jobs in its reported total were returned.",
            file=sys.stderr,
        )
    return jobs


@dataclass
class SiteDetails:
    # None means the Ort field was absent; "" means SPAR showed a blank field.
    address: str | None = None
    org_type: str | None = None


class SiteDetailsParser(HTMLParser):
    """Extract the Ort field and the displayed job ID prefix."""

    def __init__(self) -> None:
        super().__init__()
        self.details = SiteDetails()
        self.div_depth = 0
        self.field_depth = None
        self.span_depth = 0
        self.part_depth = None
        self.part = None
        self.title: list[str] = []
        self.value: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        classes = (dict(attrs).get("class") or "").split()
        if tag == "div":
            self.div_depth += 1
            if "custom-field" in classes:
                self.field_depth = self.div_depth
                self.title, self.value = [], []
        if tag == "span":
            self.span_depth += 1
            if self.field_depth is not None and self.part is None:
                if "custom-field__title" in classes:
                    self.part = self.title
                elif "custom-field__value" in classes:
                    self.part = self.value
                if self.part is not None:
                    self.part_depth = self.span_depth

    def handle_endtag(self, tag: str) -> None:
        if tag == "span":
            if self.part_depth == self.span_depth:
                self.part = None
                self.part_depth = None
            self.span_depth -= 1
        if tag == "div":
            if self.field_depth == self.div_depth:
                self.finish_field()
                self.field_depth = None
                self.part = None
                self.part_depth = None
            self.div_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.part is not None:
            self.part.append(data)

    def finish_field(self) -> None:
        title = clean_text("".join(self.title))
        value = clean_text("".join(self.value))
        if title == "Ort" and not self.details.address:
            self.details.address = value or ""
        elif title is None and value and self.details.org_type is None:
            if match := re.fullmatch(r"ID (.+) [0-9]+", value):
                self.details.org_type = match[1]


def fetch_site_details(opener: PoliteOpener, job_id: int | str) -> SiteDetails:
    url = DETAIL_URL + urllib.parse.quote(str(job_id), safe="")
    response, body = opener.get(url, "text/html,application/xhtml+xml")
    parser = SiteDetailsParser()
    parser.feed(body.decode(response.headers.get_content_charset() or "utf-8", "replace"))
    parser.close()
    return parser.details
