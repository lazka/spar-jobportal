"""Throttled HTTP requests for the data updater."""

from __future__ import annotations

import gzip
import http.cookiejar
import random
import time
import urllib.error
import urllib.request
from http.client import HTTPResponse

USER_AGENT = "SPARJobsStatsBot/1.0 (+public-careers-statistics)"


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

        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            pause = self.delay - (time.monotonic() - self.last_request_at)
            if pause > 0:
                time.sleep(pause)
            self.last_request_at = time.monotonic()

            try:
                with self.opener.open(
                    urllib.request.Request(url, headers=headers),
                    timeout=self.timeout,
                ) as response:
                    body = response.read()
                    if response.headers.get("Content-Encoding", "").lower() == "gzip":
                        body = gzip.decompress(body)
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
