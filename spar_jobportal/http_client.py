"""Throttled HTTP requests for the data updater."""

from __future__ import annotations

import gzip
import http.cookiejar
import logging
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from http.client import HTTPResponse

LOGGER = logging.getLogger(__name__)
USER_AGENT = "SPARJobsStatsBot/1.0 (+public-careers-statistics)"


def log_target(url: str) -> str:
    """Keep the host and path, but never log credentials or query parameters."""
    parts = urllib.parse.urlsplit(url)
    return f"{parts.scheme}://{parts.netloc.rsplit('@', 1)[-1]}{parts.path}"


class PoliteOpener:
    def __init__(self, delay: float, timeout: float, retries: int) -> None:
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.delay = delay
        self.timeout = timeout
        self.retries = retries
        self.last_request_at = 0.0

    def get(
        self, url: str, accept: str, extra_headers: dict[str, str] | None = None
    ) -> tuple[HTTPResponse, bytes]:
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": accept,
            "Accept-Language": "de-AT,de;q=0.9,en;q=0.7",
            "Accept-Encoding": "gzip",
        }
        if extra_headers:
            headers.update(extra_headers)

        target = log_target(url)
        attempts = self.retries + 1
        last_error: Exception | None = None
        for attempt in range(attempts):
            pause = self.delay - (time.monotonic() - self.last_request_at)
            if pause > 0:
                time.sleep(pause)
            self.last_request_at = time.monotonic()
            LOGGER.info("GET %s (attempt %d/%d)", target, attempt + 1, attempts)

            try:
                with self.opener.open(
                    urllib.request.Request(url, headers=headers),
                    timeout=self.timeout,
                ) as response:
                    body = response.read()
                    if response.headers.get("Content-Encoding", "").lower() == "gzip":
                        body = gzip.decompress(body)
                    LOGGER.info(
                        "GET %s -> HTTP %d (%.2fs)",
                        target,
                        response.status,
                        time.monotonic() - self.last_request_at,
                    )
                return response, body
            except urllib.error.HTTPError as error:
                last_error = error
                LOGGER.warning(
                    "GET %s -> HTTP %d (attempt %d/%d)", target, error.code, attempt + 1, attempts
                )
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
                cause = error.reason if isinstance(error, urllib.error.URLError) else error
                label = type(cause).__name__ if isinstance(cause, BaseException) else "URLError"
                LOGGER.warning("GET %s -> %s (attempt %d/%d)", target, label, attempt + 1, attempts)
                if attempt == self.retries:
                    raise
                wait = 2**attempt

            delay = min(wait + random.uniform(0, 0.4), 30)
            LOGGER.info("Retrying GET %s in %.1fs", target, delay)
            time.sleep(delay)

        assert last_error is not None
        raise last_error
