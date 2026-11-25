#!/usr/bin/env python3
"""Export all currently listed SPAR jobs using the careers portal's JSON list endpoint.

The script makes one request for the public search page to establish an anonymous
session and read the list configuration/temporary token. Job records are then
retrieved from the same JSON endpoint the search page uses; detail pages are not
requested.
"""

from __future__ import annotations

import argparse
import gzip
import http.cookiejar
import json
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


SEARCH_PAGE = "https://jobs.spar.at/de_DE/SparCareers/offene-stellen"
LIST_ENDPOINT = "https://jobs.spar.at/45/_portalList"
USER_AGENT = "SPARJobsStatsBot/1.0 (+public-careers-statistics)"
MAX_PAGE_SIZE = 50


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


class PoliteOpener:
    def __init__(self, delay: float, timeout: float, retries: int) -> None:
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies)
        )
        self.delay = delay
        self.timeout = timeout
        self.retries = retries
        self.last_request_at = 0.0

    def get(self, url: str, accept: str, extra_headers: dict[str, str] | None = None):
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": accept,
            "Accept-Language": "de-AT,de;q=0.9,en;q=0.7",
            "Accept-Encoding": "gzip",
        }
        if extra_headers:
            headers.update(extra_headers)

        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            pause = self.delay - (time.monotonic() - self.last_request_at)
            if pause > 0:
                time.sleep(pause)
            self.last_request_at = time.monotonic()

            try:
                response = self.opener.open(
                    urllib.request.Request(url, headers=headers),
                    timeout=self.timeout,
                )
                body = response.read()
                if response.headers.get("Content-Encoding", "").lower() == "gzip":
                    body = gzip.decompress(body)
                response.close()
                return response, body
            except urllib.error.HTTPError as error:
                last_error = error
                retryable = error.code == 429 or 500 <= error.code <= 599
                retry_after = error.headers.get("Retry-After")
                error.close()
                if not retryable or attempt == self.retries:
                    raise
                try:
                    wait = float(retry_after) if retry_after else 2**attempt
                except ValueError:
                    wait = 2**attempt
            except (urllib.error.URLError, TimeoutError) as error:
                last_error = error
                if attempt == self.retries:
                    raise
                wait = 2**attempt

            time.sleep(min(wait + random.uniform(0, 0.4), 30))

        assert last_error is not None
        raise last_error


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
    return config, response.geturl()


def api_params(config: dict[str, Any], offset: int, page_size: int) -> dict[str, str]:
    def bool_text(value: Any) -> str:
        return "true" if value else "false"

    return {
        "allowFilteringFromUrlParams": bool_text(config.get("allowFilteringFromUrlParams")),
        "allowListSorting": bool_text(config.get("allowListSorting")),
        "dynamicValueConfigs": json.dumps(config.get("dynamicValueConfigs", []), separators=(",", ":")),
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
    response, body = opener.get(url, "application/json, text/plain, */*", headers)
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
            (parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(query), parsed.fragment)
        )
    return cleaned


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-o", "--output", type=Path, default=Path("spar_jobs.json"))
    parser.add_argument("--page-size", type=int, default=MAX_PAGE_SIZE)
    parser.add_argument("--delay", type=float, default=0.4, help="Minimum seconds between requests (default: 0.4).")
    parser.add_argument("--timeout", type=float, default=30, help="Per-request timeout in seconds.")
    parser.add_argument("--retries", type=int, default=3, help="Retries for rate limits and temporary server errors.")
    parser.add_argument("--max-pages", type=int, help="Optional page limit for a small test export.")
    args = parser.parse_args()

    if not 1 <= args.page_size <= MAX_PAGE_SIZE:
        parser.error(f"--page-size must be between 1 and {MAX_PAGE_SIZE} (the portal caps it at 50).")
    if args.delay < 0 or args.timeout <= 0 or args.retries < 0:
        parser.error("--delay must be non-negative; --timeout must be positive; --retries must be non-negative.")
    if args.max_pages is not None and args.max_pages < 1:
        parser.error("--max-pages must be at least 1.")

    opener = PoliteOpener(args.delay, args.timeout, args.retries)
    try:
        config, search_page = bootstrap(opener)
    except Exception as error:
        print(f"Could not initialize the public search session: {error}", file=sys.stderr)
        return 1

    jobs: list[dict[str, Any]] = []
    seen_ids: set[int | str] = set()
    offsets: set[int] = set()
    columns: list[dict[str, Any]] = []
    reported_total: str | int | None = None
    total_limit_reached = False
    errors: list[dict[str, Any]] = []
    offset = 0
    pages_fetched = 0
    reached_end = False

    while offset not in offsets:
        if args.max_pages is not None and pages_fetched >= args.max_pages:
            break
        offsets.add(offset)
        try:
            data = fetch_page(opener, config, search_page, offset, args.page_size)
        except Exception as error:
            errors.append({"offset": offset, "error": str(error)})
            print(f"Request failed at offset {offset}: {error}", file=sys.stderr)
            break

        pages_fetched += 1
        columns = data.get("columns", columns)
        reported_total = data.get("total", reported_total)
        total_limit_reached = total_limit_reached or bool(data.get("totalLimitReached"))
        page_records = data["results"]
        page_links = data.get("links", [])

        for index, record in enumerate(page_records):
            job_id = record.get("id")
            if job_id is None or job_id in seen_ids:
                continue
            seen_ids.add(job_id)
            jobs.append({
                "id": job_id,
                "record": record,
                "links": safe_links(page_links[index]) if index < len(page_links) else {},
            })

        print(
            f"Page {pages_fetched}: offsets {data.get('recordsFrom', '?')}-"
            f"{data.get('recordsTo', '?')}; {len(jobs)} unique jobs so far.",
            file=sys.stderr,
        )

        next_values = [
            int(control["value"])
            for control in data.get("navigationControls", [])
            if control.get("linkType") == "paginationNextLink"
            and str(control.get("value", "")).isdigit()
        ]
        if not next_values:
            reached_end = True
            break
        next_offset = next_values[0]
        if next_offset <= offset:
            errors.append({"offset": offset, "error": f"Non-advancing next offset: {next_offset}"})
            break
        offset = next_offset

    complete = reached_end and not errors and not total_limit_reached
    result = {
        "source": "SPAR public careers search JSON",
        "note": "Uses the public list API; short-lived qtvc parameters are removed from exported links.",
        "search_page": search_page,
        "api_endpoint": LIST_ENDPOINT,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "page_size_requested": args.page_size,
        "pages_fetched": pages_fetched,
        "reported_total": reported_total,
        "unique_jobs": len(jobs),
        "complete": complete,
        "total_limit_reached": total_limit_reached,
        "columns": columns,
        "jobs": jobs,
        "errors": errors,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_name(args.output.name + ".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(
        f"Wrote {len(jobs)} unique jobs from {pages_fetched} API pages to {args.output} "
        f"(complete={complete}).",
        file=sys.stderr,
    )
    return 0 if complete else 1


if __name__ == "__main__":
    raise SystemExit(main())
