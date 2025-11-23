import os
import requests
import json
import sys
from dataclasses import dataclass
from typing import Any, Dict
from dotenv import load_dotenv

load_dotenv()

API_BASE_URL = "https://vpnapi.io/api"
API_KEY = os.getenv("VPNAPI_KEY")
if not API_KEY:
    raise RuntimeError("VPNAPI_KEY environment variable not set")


@dataclass
class IpInfo:
    ip: str | None
    security: dict
    location: dict
    network: dict


def fetch_ip_info(ip: str) -> IpInfo:
    url = f"{API_BASE_URL}/{ip}?key={API_KEY}"
    resp = requests.get(url, timeout=5)
    resp.raise_for_status()
    data = resp.json()

    return IpInfo(
        ip=data.get("ip"),
        security=data.get("security", {}) or {},
        location=data.get("location", {}) or {},
        network=data.get("network", {}) or {},
    )


def slim_ip_info(ip_info: IpInfo) -> Dict[str, Any]:
    """Gereksiz alanları kırpılmış, sade bir ip_info döndür."""
    security = ip_info.security or {}
    location = ip_info.location or {}

    return {
        "ip": ip_info.ip,
        "security": {
            "vpn": security.get("vpn"),
            "proxy": security.get("proxy"),
            "tor": security.get("tor"),
            "relay": security.get("relay"),
        },
        "location": {
            "city": location.get("city"),
            "region": location.get("region"),
            "country": location.get("country"),
            "country_code": location.get("country_code"),
            "time_zone": location.get("time_zone"),
        },
        # network, latitude/longitude, continent vs. BİLİNÇLİ OLARAK YOK
    }


def check_ip_country(ip: str, expected_country_code: str | None) -> Dict[str, Any]:
    ip_info = fetch_ip_info(ip)
    slim = slim_ip_info(ip_info)

    ip_country = slim["location"].get("country_code")
    same_country: bool | None = None

    if ip_country is not None and expected_country_code is not None:
        same_country = ip_country.upper() == expected_country_code.upper()

    return {
        "same_country": same_country,
        "ip_country_code": ip_country,
        "expected_country_code": expected_country_code,
        "ip_info": slim,
    }


def main() -> int:
    if len(sys.argv) < 2:
        print(
            "Usage: python ip_check.py <ip> [expected_country_code]", file=sys.stderr)
        return 1

    ip = sys.argv[1]
    expected_country = sys.argv[2] if len(sys.argv) > 2 else None

    result = check_ip_country(ip, expected_country)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
