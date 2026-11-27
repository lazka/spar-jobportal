import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch

from spar_jobportal import cli as updater
from spar_jobportal import locations, spar


def record(job_id, unit_id):
    return {
        "id": job_id,
        "fields": {
            "name": {"stringValue": "Originaltitel (m/w/d)"},
            "unit": {
                "stringValue": "SPAR Filiale",
                "jsonValue": {"value": {"value": {"id": unit_id}}},
            },
            "location": {"stringValue": "Raum Graz, mehrere Standorte"},
        },
    }


def page(total, records, next_offset=None, limited=False):
    return {
        "total": total,
        "totalLimitReached": limited,
        "columns": [
            {"code": "name", "label": "Name"},
            {"code": "unit", "label": "Organisationseinheit"},
            {"code": "location", "label": "Dienstort"},
        ],
        "results": records,
        "links": [
            {"detailPage": "https://jobs.spar.at/posting?qtvc=token&jobId=1"} for _ in records
        ],
        "navigationControls": (
            [{"linkType": "paginationNextLink", "value": next_offset}]
            if next_offset is not None
            else []
        ),
    }


class UpdateTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        paths = patch.multiple(
            updater,
            ROOT=root,
            ADDRESSES=root / "addresses.json",
            CORRECTIONS=root / "corrections.json",
            GEOCODES=root / "geocodes.json",
            SHOPS_CACHE=root / "spar_shops.json",
            OUTPUT=root / "jobs.json",
        )
        paths.start()
        self.addCleanup(paths.stop)
        for path in (updater.ADDRESSES, updater.CORRECTIONS, updater.GEOCODES):
            updater.save_json(path, {})
        shops = patch.object(updater, "fetch_shops", return_value={})
        self.fetch_shops = shops.start()
        self.addCleanup(shops.stop)

    def run_command(self, *args):
        return updater.main(args)

    def test_update_uses_only_local_locations_and_preserves_new_jobs(self):
        updater.save_json(updater.ADDRESSES, {"10": {"address": "Hauptplatz 1, Graz"}})
        updater.save_json(
            updater.GEOCODES,
            {
                "hauptplatz 1, graz": {"status": "matched", "latitude": 47, "longitude": 15},
            },
        )
        with (
            patch.object(spar, "bootstrap", return_value=({}, spar.SEARCH_PAGE)),
            patch.object(
                spar,
                "fetch_page",
                side_effect=[
                    page("1+", [record(1, 10)], 1),
                    page("2", [record(2, 20)], limited=True),
                ],
            ) as fetch,
            patch.object(updater, "fetch_site_details") as detail,
            patch.object(updater, "geocode") as geocode,
        ):
            self.assertEqual(self.run_command("update"), 0)
        self.assertEqual([call.args[3] for call in fetch.call_args_list], [0, 1])
        detail.assert_not_called()
        geocode.assert_not_called()
        dataset = updater.read_object(updater.OUTPUT)
        self.assertEqual(datetime.fromisoformat(dataset["lastUpdated"]).utcoffset(), timedelta(0))
        known, unknown = dataset["jobs"]
        self.assertEqual(known["unit"]["coordinates"], [47, 15])
        self.assertNotIn("addressSourceJobId", known["unit"])
        self.assertEqual(known["title"], "Originaltitel (m/w/d)")
        self.assertEqual(known["detailUrl"], "https://jobs.spar.at/posting?jobId=1")
        self.assertEqual(
            unknown["unit"],
            {
                "id": 20,
                "name": "SPAR Filiale",
                "address": None,
                "coordinates": None,
                "relatedShop": None,
            },
        )
        self.assertEqual(unknown["location"], "Raum Graz, mehrere Standorte")

    def test_update_exports_shop_metadata_and_offline_maintain_preserves_it(self):
        name = "ES1-03-500Frankenburg"
        updater.save_json(
            updater.ADDRESSES, {"10": {"address": "Hauptstraße 42, 4873 Frankenburg"}}
        )
        self.fetch_shops.return_value = {
            "3500": {
                "bnr": "3500",
                "type": 4,
                "shopTypeName": "EUROSPAR",
                "location": {"address": "Hauptstraße 42", "post": "4873"},
            }
        }
        job = {"id": 1, "unit": {"id": 10, "name": name}}
        with patch.object(updater, "fetch_jobs", return_value=[job]):
            self.assertEqual(self.run_command("update"), 0)
        self.fetch_shops.assert_called_once()
        self.assertEqual(
            updater.read_object(updater.SHOPS_CACHE),
            {"shop": [self.fetch_shops.return_value["3500"]]},
        )
        dataset = updater.read_object(updater.OUTPUT)
        unit = dataset["jobs"][0]["unit"]
        self.assertNotIn("regionCode", unit)
        self.assertNotIn("unitGroup", unit)
        self.assertEqual(unit["relatedShop"], {"bnr": "3500", "shopType": "EUROSPAR"})
        self.assertNotIn("shopType", unit)
        dataset["jobs"][0]["unit"] = {**unit, "unitGroup": "ES1", "addressSourceJobId": 1}
        updater.save_json(updater.OUTPUT, dataset)
        shops_before = updater.SHOPS_CACHE.read_bytes()
        self.fetch_shops.reset_mock()
        self.assertEqual(self.run_command("maintain", "--max-requests", "0"), 0)
        self.fetch_shops.assert_not_called()
        self.assertEqual(updater.read_object(updater.OUTPUT)["jobs"][0]["unit"], unit)
        self.assertEqual(updater.SHOPS_CACHE.read_bytes(), shops_before)

    def test_incomplete_jobs_fetch_refreshes_shops_but_preserves_jobs(self):
        shop = {"bnr": "3500", "shopTypeName": "EUROSPAR"}
        self.fetch_shops.return_value = {"3500": shop}
        updater.save_json(updater.OUTPUT, {"lastUpdated": "2026-11-25T21:21:10+00:00", "jobs": []})
        before = updater.OUTPUT.read_bytes()
        with (
            patch.object(spar, "bootstrap", return_value=({}, spar.SEARCH_PAGE)),
            patch.object(spar, "fetch_page", return_value=page("2", [record(1, 10)])),
        ):
            self.assertEqual(self.run_command("update"), 1)
        self.assertEqual(updater.read_object(updater.SHOPS_CACHE), {"shop": [shop]})
        self.assertEqual(updater.OUTPUT.read_bytes(), before)

    def test_repeated_id_restarts_pagination_once(self):
        first_page = page("2", [record(1, 10)], 1)
        duplicate_page = page("2", [record(1, 10)])
        final_page = page("2", [record(2, 20)])
        for retry_page, expected_exit in ((final_page, 0), (duplicate_page, 1)):
            with self.subTest(expected_exit=expected_exit):
                updater.save_json(updater.OUTPUT, {"jobs": []})
                before = updater.OUTPUT.read_bytes()
                with (
                    patch.object(spar, "bootstrap", return_value=({}, spar.SEARCH_PAGE)),
                    patch.object(
                        spar,
                        "fetch_page",
                        side_effect=[first_page, duplicate_page, first_page, retry_page],
                    ) as fetch,
                ):
                    self.assertEqual(self.run_command("update"), expected_exit)
                self.assertEqual([call.args[3] for call in fetch.call_args_list], [0, 1, 0, 1])
                if expected_exit == 0:
                    jobs = updater.read_object(updater.OUTPUT)["jobs"]
                    self.assertEqual([job["id"] for job in jobs], [1, 2])
                else:
                    self.assertEqual(updater.OUTPUT.read_bytes(), before)

    def test_maintain_geocodes_only_missing_units_and_reuses_results(self):
        updater.save_json(
            updater.OUTPUT,
            [
                {
                    "id": 1,
                    "unit": {"id": 10, "name": "SM3-04-588 Großweikersdorf"},
                    "location": "not a site address",
                },
                {"id": 2, "unit": {"id": 10}},
                {"id": 3, "unit": {"id": 20}},
                {"id": 4, "unit": {"id": 30}},
            ],
        )
        updater.save_json(
            updater.CORRECTIONS,
            {
                "20": {
                    "latitude": 48,
                    "longitude": 14,
                    "source": "Verified map",
                    "address": "Manual address",
                },
                "30": {"address": "Corrected query"},
            },
        )
        with (
            patch.object(updater, "fetch_jobs") as fetch_jobs,
            patch.object(
                updater,
                "fetch_site_details",
                return_value=spar.SiteDetails("Site address", "INTERSPAR"),
            ) as detail,
            patch.object(
                updater,
                "geocode",
                side_effect=[
                    {"status": "matched", "latitude": 47, "longitude": 15},
                    {"status": "not_specific"},
                ],
            ) as geocode,
        ):
            self.assertEqual(self.run_command("maintain"), 0)
            previous = updater.OUTPUT.read_bytes()
            self.assertEqual(self.run_command("maintain"), 0)
            self.assertEqual(updater.OUTPUT.read_bytes(), previous)
        fetch_jobs.assert_not_called()
        self.assertEqual([call.args[1] for call in detail.call_args_list], [1])
        self.assertEqual(
            [call.args[1] for call in geocode.call_args_list], ["Site address", "Corrected query"]
        )
        self.assertEqual(
            updater.read_object(updater.ADDRESSES),
            {
                "10": {
                    "address": "Site address",
                    "name": "SM3-04-588 Großweikersdorf",
                    "orgType": "INTERSPAR",
                },
            },
        )
        jobs = updater.read_object(updater.OUTPUT)["jobs"]
        self.assertEqual(
            [job["unit"]["coordinates"] for job in jobs], [[47, 15], [47, 15], [48, 14], None]
        )
        self.assertEqual(jobs[2]["unit"]["address"], "Manual address")

    def test_offline_maintenance_applies_verified_corrections_without_requests(self):
        updater.save_json(
            updater.OUTPUT,
            {
                "lastUpdated": "2026-11-25T21:21:10+00:00",
                "jobs": [{"id": 1, "unit": {"id": 10}}, {"id": 2, "unit": {"id": 20}}],
            },
        )
        updater.save_json(
            updater.CORRECTIONS, {"10": {"latitude": 48, "longitude": 14, "source": "Map"}}
        )
        with (
            patch.object(updater.PoliteOpener, "get") as get,
            patch.object(updater, "datetime") as clock,
        ):
            clock.now.return_value = datetime(2026, 11, 26, 8, tzinfo=timezone.utc)
            self.assertEqual(self.run_command("maintain", "--max-requests", "0"), 0)
        get.assert_not_called()
        dataset = updater.read_object(updater.OUTPUT)
        self.assertEqual(dataset["lastUpdated"], "2026-11-26T08:00:00+00:00")
        self.assertEqual(dataset["jobs"][0]["unit"]["coordinates"], [48, 14])

    def test_offline_maintenance_migrates_older_output_only_once(self):
        updater.save_json(updater.OUTPUT, [])
        self.assertEqual(self.run_command("maintain", "--max-requests", "0"), 0)
        self.assertEqual(updater.read_object(updater.OUTPUT)["jobs"], [])
        with patch.object(updater, "datetime") as clock:
            self.assertEqual(self.run_command("maintain", "--max-requests", "0"), 0)
        clock.now.assert_not_called()

    def test_maintenance_limit_defers_new_queries_but_uses_cached_results(self):
        updater.save_json(updater.OUTPUT, [{"id": n, "unit": {"id": n}} for n in (1, 2, 3)])
        updater.save_json(
            updater.CORRECTIONS, {"1": "First site", "2": "Deferred site", "3": "First site"}
        )
        with patch.object(
            updater,
            "geocode",
            return_value={
                "status": "matched",
                "latitude": 47,
                "longitude": 15,
            },
        ) as geocode:
            self.assertEqual(self.run_command("maintain", "--max-requests", "1"), 0)
        self.assertEqual([call.args[1] for call in geocode.call_args_list], ["First site"])
        jobs = updater.read_object(updater.OUTPUT)["jobs"]
        self.assertEqual([job["unit"]["coordinates"] for job in jobs], [[47, 15], None, [47, 15]])


class LocationLookupTests(unittest.TestCase):
    def test_coordinate_values_must_be_numeric_and_in_range(self):
        self.assertIsNone(locations.coordinates({"latitude": True, "longitude": 14}))
        self.assertIsNone(locations.coordinates({"latitude": 91, "longitude": 14}))
        self.assertEqual(locations.coordinates({"latitude": 48, "longitude": 14}), [48, 14])

    def test_detail_parser_uses_ort_and_the_unlabeled_job_id(self):
        parser = spar.SiteDetailsParser()
        parser.feed("""
            <div class="custom-field"><span class="custom-field__title">Dienstort</span>
              <span class="custom-field__value">Raum Graz</span></div>
            <div class="custom-field"><span class="custom-field__title">Ort</span>
              <span class="custom-field__value"><span>Hauptplatz 1</span>, 8010 Graz</span></div>
            <div class="custom-field"><span class="custom-field__title">Start</span>
              <span class="custom-field__value">ID OTHER 1234</span></div>
            <div class="custom-field"><span class="custom-field__title"></span>
              <span class="custom-field__value">ID
                INTERSPAR 7905</span></div>
        """)
        self.assertEqual(parser.details, spar.SiteDetails("Hauptplatz 1, 8010 Graz", "INTERSPAR"))

    def test_detail_parser_keeps_multiword_prefix_and_requires_a_number(self):
        parser = spar.SiteDetailsParser()
        parser.feed("""
            <div class="custom-field"><span class="custom-field__value">ID SPAR ICS</span></div>
        """)
        self.assertIsNone(parser.details.org_type)
        parser.feed("""
            <div class="custom-field"><span class="custom-field__value">ID
              SPAR&nbsp;ICS 7819</span></div>
        """)
        self.assertEqual(parser.details.org_type, "SPAR ICS")

    def test_nominatim_rejects_area_or_road_but_accepts_numbered_house(self):
        results = [
            {"category": "boundary", "name": "Graz"},
            {"category": "highway", "name": "Hauptplatz"},
        ]
        opener = Mock()
        opener.get.return_value = (None, json.dumps(results).encode())
        self.assertEqual(locations.geocode(opener, "Hauptplatz 1")["status"], "not_specific")
        results.append(
            {
                "category": "place",
                "type": "house",
                "address": {"house_number": "1"},
                "lat": "47.07",
                "lon": "15.44",
            }
        )
        opener.get.return_value = (None, json.dumps(results).encode())
        self.assertEqual(
            locations.coordinates(locations.geocode(opener, "Hauptplatz 1")), [47.07, 15.44]
        )
