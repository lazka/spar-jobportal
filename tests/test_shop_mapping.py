import json
from unittest.mock import Mock

import pytest

from spar_jobportal import shops


def test_mobile_catalogue_is_indexed_by_branch_number():
    shop = {"bnr": "4973", "shopTypeName": "SPAR Supermarkt"}
    opener = Mock()
    opener.get.return_value = (None, json.dumps({"shop": [shop]}).encode())
    assert shops.fetch_shops(opener) == {"4973": shop}
    opener.get.assert_called_once_with(shops.SHOPS_ENDPOINT, "application/json")
    assert shops.decode_bnr("SYS04-0973") == "4973"


def test_split_code_before_decoding():
    code = shops.unit_code("  SM3-04-137 Leopoldsdorf im Marchfeld  ")
    assert code == "SM3-04-137"
    assert shops.decode_bnr(code) == "4137"
    assert shops.decode_bnr("Leopoldsdorf") is None


@pytest.mark.parametrize(
    ("name", "code", "bnr"),
    [
        ("ZN 2-376 KA", "ZN 2-376", "2376"),
        ("ZN 06-438 TS", "ZN 06-438", "6438"),
        ("ZN 2-37600 KA", "ZN", None),
        ("ZN 2", "ZN", None),
    ],
)
def test_decode_zn_store_codes(name, code, bnr):
    assert shops.unit_code(name) == code
    assert shops.decode_bnr(code) == bnr


@pytest.mark.parametrize("suffix", ["", " Frankenburg", "Frankenburg", ",Frankenburg"])
def test_split_regional_code_at_the_first_non_digit(suffix):
    name = f"ES1-03-500{suffix}"
    assert shops.unit_code(name) == "ES1-03-500"
    assert shops.decode_bnr(shops.unit_code(name)) == "3500"


def test_split_does_not_cut_a_long_branch_number():
    code = shops.unit_code("ES1-03-50000Frankenburg")
    assert code == "ES1-03-50000Frankenburg"
    assert shops.decode_bnr(code) is None


def test_interspar_food_service_uses_one_instead_of_zero():
    assert shops.decode_bnr("IM55") == "8550"
    assert shops.decode_bnr("IM55-100") == "8551"
    assert shops.decode_bnr("IM304N") is None
    catalogue = {
        "8550": {"bnr": "8550", "shopTypeName": "INTERSPAR"},
        "8551": {"bnr": "8551", "shopTypeName": "Restaurant"},
    }
    restaurant = shops.map_unit({"name": "IM55-100 Restaurant"}, catalogue)
    assert restaurant["shopTypeName"] == "Restaurant"


@pytest.mark.parametrize(
    ("name", "decoded_bnr", "catalogue_bnr", "label"),
    [
        ("IM53-100 Cappuccino", "8531", "100107", "CAFE Cappuccino"),
        ("EH02-0028 Ennemoser Georg", "2028", "2552", "SPAR Supermarkt"),
    ],
)
def test_units_are_unmatched_when_their_decoded_branch_number_is_absent(
    name, decoded_bnr, catalogue_bnr, label
):
    assert shops.decode_bnr(shops.unit_code(name)) == decoded_bnr
    catalogue = {catalogue_bnr: {"bnr": catalogue_bnr, "shopTypeName": label}}
    result = shops.map_unit({"name": name}, catalogue)
    assert result["bnr"] is None
    assert result["shopTypeName"] is None


# Examples checked against the SPAR v8 catalogue. No live requests in tests.
@pytest.mark.parametrize(
    ("name", "street", "post", "city", "bnr", "shop_type", "label"),
    [
        (
            "SM3-04-137 Leopoldsdorf",
            "Hauptstraße 19",
            "2285",
            "Leopoldsdorf",
            "4137",
            2,
            "SPAR Supermarkt",
        ),
        (
            "SM3-01-220 ES Dornbirn-Rose",
            "Arlbergstraße 2",
            "6850",
            "Dornbirn",
            "1220",
            4,
            "EUROSPAR",
        ),
        (
            "SM3-04-7514 SPAR SM Kematen/Ybbs",
            "33.A Straße 4",
            "3331",
            "Kematen an der Ybbs",
            "7514",
            2,
            "SPAR Supermarkt",
        ),
        (
            "IM38 Klosterneuburg",
            "Albrechtstraße 115",
            "3400",
            "Klosterneuburg",
            "8380",
            5,
            "INTERSPAR",
        ),
    ],
)
def test_verified_shop_examples(name, street, post, city, bnr, shop_type, label):
    shop = {
        "bnr": bnr,
        "type": shop_type,
        "shopTypeName": label,
        "location": {"address": street, "post": post},
    }
    unit = {"name": name, "address": f"{street}, {post} {city}, Österreich"}
    result = shops.map_unit(unit, {bnr: shop})
    assert (result["bnr"], result["shopType"], result["shopTypeName"]) == (bnr, shop_type, label)


def test_matching_bnr_does_not_require_the_same_address():
    unit = {"name": "SM-05-412 Murau, St.Egidi", "address": "St.Egidi 76A, 8850 Murau"}
    shop = {
        "bnr": "5412",
        "type": 2,
        "shopTypeName": "SPAR Supermarkt",
        "location": {"address": "St. Egidi 76a", "post": "8850"},
    }
    result = shops.map_unit(unit, {"5412": shop})
    assert result["bnr"] == "5412"
    assert result["shopTypeName"] == "SPAR Supermarkt"
    assert shops.map_unit(unit, {})["shopTypeName"] is None
