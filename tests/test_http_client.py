import logging
from email.message import Message
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError

import pytest

from spar_jobportal.http_client import PoliteOpener


def test_forbidden_request_logs_path_and_status_without_query(caplog):
    url = "https://jobs.spar.at/de_DE/SparCareers/job-detail/7905?token=private"
    opener = PoliteOpener(delay=0, timeout=1, retries=2)
    forbidden = HTTPError(url, 403, "", Message(), None)
    with patch.object(opener.opener, "open", side_effect=forbidden) as get:
        with pytest.raises(HTTPError):
            opener.get(url, "text/html")
    get.assert_called_once()
    assert "GET https://jobs.spar.at/de_DE/SparCareers/job-detail/7905 -> HTTP 403" in caplog.text
    assert "token" not in caplog.text
    assert "private" not in caplog.text


def test_verbose_http_logging_reports_retry_and_success(caplog):
    url = "https://jobs.spar.at/45/_portalList?qtvc=private"
    opener = PoliteOpener(delay=0, timeout=1, retries=1)
    context = MagicMock()
    response = context.__enter__.return_value
    response.status = 200
    response.headers = {}
    response.read.return_value = b"private response body"
    headers = Message()
    headers["Retry-After"] = "2"
    retry = HTTPError(url, 429, "", headers, None)

    with (
        caplog.at_level(logging.INFO),
        patch.object(opener.opener, "open", side_effect=[retry, context]),
        patch("spar_jobportal.http_client.random.uniform", return_value=0),
        patch("spar_jobportal.http_client.time.sleep") as sleep,
    ):
        assert opener.get(url, "application/json") == (response, b"private response body")

    sleep.assert_called_once_with(2)
    assert "HTTP 429 (attempt 1/2)" in caplog.text
    assert "Retrying GET https://jobs.spar.at/45/_portalList in 2.0s" in caplog.text
    assert "GET https://jobs.spar.at/45/_portalList (attempt 2/2)" in caplog.text
    assert "HTTP 200" in caplog.text
    assert "private" not in caplog.text
