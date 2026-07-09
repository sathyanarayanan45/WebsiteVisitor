"""
Website Insights — AWS Lambda Function

Runtime: Python 3.12

Invoked by API Gateway (HTTP API, GET /visitor-count).

Two modes, selected by the ?mode query parameter:
  - default    → records a visit with metadata (device, browser, page,
                 traffic source, unique flag, per-day count) and returns
                 the new total
  - ?mode=read → returns the full analytics snapshot WITHOUT recording
                 anything (used by the dashboard)

Storage design — everything lives in ONE DynamoDB item (counterId="main"),
using flat, prefixed attribute names so every counter can be incremented
atomically with ADD (which auto-creates missing attributes):

    visits            total page views
    uniqueVisits      first-time visitors (client-flagged via localStorage)
    day_2026-07-09    visits on a given day
    dev_Mobile        visits per device type
    br_Chrome         visits per browser
    pg_/visit.html    visits per page
    src_Direct        visits per traffic source
    recent            list of the last 20 visits (newest first)
"""

import json
import logging
import re
import time

import boto3
from botocore.exceptions import BotoCoreError, ClientError

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TABLE_NAME = "WebsiteVisitorCounter"
COUNTER_ID = "main"
RECENT_LIMIT = 20        # how many recent visits to keep
ACTIVE_WINDOW_SEC = 300  # "active now" = visits in the last 5 minutes
DAYS_IN_CHART = 7        # how many days the dashboard chart shows

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
}

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize outside the handler so connections are reused on warm starts
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _classify_device(user_agent):
    """Best-effort device type from the User-Agent header."""
    ua = user_agent.lower()
    if "ipad" in ua or "tablet" in ua:
        return "Tablet"
    if "mobi" in ua or "android" in ua or "iphone" in ua:
        return "Mobile"
    return "Desktop"


def _classify_browser(user_agent):
    """Best-effort browser name from the User-Agent header (order matters)."""
    ua = user_agent.lower()
    if "edg" in ua:
        return "Edge"
    if "opr" in ua or "opera" in ua:
        return "Opera"
    if "firefox" in ua:
        return "Firefox"
    if "chrome" in ua or "crios" in ua:
        return "Chrome"
    if "safari" in ua:
        return "Safari"
    return "Other"


def _sanitize(value, fallback, max_length=40):
    """Keep attribute-name fragments safe and short."""
    if not value or not isinstance(value, str):
        return fallback
    cleaned = re.sub(r"[^A-Za-z0-9/_\-.]", "", value)[:max_length]
    return cleaned or fallback


def _today():
    """Today's date (UTC) as YYYY-MM-DD."""
    return time.strftime("%Y-%m-%d", time.gmtime())


def _to_int(value, default=0):
    """DynamoDB returns numbers as Decimal — normalise to int."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body),
    }


# ---------------------------------------------------------------------------
# Record a visit
# ---------------------------------------------------------------------------
def _record_visit(event, query_params):
    """Increment all counters atomically and store the visit metadata."""
    headers = event.get("headers") or {}
    user_agent = headers.get("user-agent") or headers.get("User-Agent") or ""

    device = _classify_device(user_agent)
    browser = _classify_browser(user_agent)
    page = _sanitize(query_params.get("page"), "/")
    source = _sanitize(query_params.get("src"), "Direct")
    is_new_visitor = query_params.get("new") == "1"

    # Read the current recent-visits list so we can prepend and cap it.
    # (The counters below stay fully atomic; only this list is best-effort.)
    current = table.get_item(Key={"counterId": COUNTER_ID}).get("Item") or {}
    recent = list(current.get("recent") or [])[: RECENT_LIMIT - 1]
    entry = {
        "t": int(time.time()),
        "d": device,
        "b": browser,
        "p": page,
        "s": source,
    }

    # Build the atomic update. ADD auto-creates missing numeric attributes,
    # so the item and every counter appear automatically on first use.
    add_parts = ["visits :one", "#day :one", "#dev :one",
                 "#br :one", "#pg :one", "#src :one"]
    if is_new_visitor:
        add_parts.append("uniqueVisits :one")

    response = table.update_item(
        Key={"counterId": COUNTER_ID},
        UpdateExpression=f"ADD {', '.join(add_parts)} SET recent = :recent",
        ExpressionAttributeNames={
            "#day": f"day_{_today()}",
            "#dev": f"dev_{device}",
            "#br": f"br_{browser}",
            "#pg": f"pg_{page}",
            "#src": f"src_{source}",
        },
        ExpressionAttributeValues={
            ":one": 1,
            ":recent": [entry] + recent,
        },
        ReturnValues="ALL_NEW",
    )

    visits = _to_int(response["Attributes"].get("visits"))
    logger.info("Visit recorded: total=%d device=%s browser=%s page=%s",
                visits, device, browser, page)

    return _response(200, {"visits": visits, "recorded": True})


# ---------------------------------------------------------------------------
# Read the analytics snapshot
# ---------------------------------------------------------------------------
def _read_stats():
    """Return the full analytics snapshot without recording anything."""
    item = table.get_item(Key={"counterId": COUNTER_ID}).get("Item") or {}

    # Split the flat prefixed attributes back into category maps
    devices, browsers, pages, sources, day_counts = {}, {}, {}, {}, {}
    for key, value in item.items():
        if key.startswith("dev_"):
            devices[key[4:]] = _to_int(value)
        elif key.startswith("br_"):
            browsers[key[3:]] = _to_int(value)
        elif key.startswith("pg_"):
            pages[key[3:]] = _to_int(value)
        elif key.startswith("src_"):
            sources[key[4:]] = _to_int(value)
        elif key.startswith("day_"):
            day_counts[key[4:]] = _to_int(value)

    # Build the last-N-days series (oldest → newest), zero-filling gaps
    now = time.time()
    days = []
    for offset in range(DAYS_IN_CHART - 1, -1, -1):
        date = time.strftime("%Y-%m-%d", time.gmtime(now - offset * 86400))
        days.append({"date": date, "count": day_counts.get(date, 0)})

    # Recent visits (newest first) + "active in the last 5 minutes"
    recent_raw = list(item.get("recent") or [])[:10]
    cutoff = int(now) - ACTIVE_WINDOW_SEC
    active_now = sum(1 for v in (item.get("recent") or [])
                     if _to_int(v.get("t")) >= cutoff)

    recent = [
        {
            "time": _to_int(v.get("t")),
            "device": v.get("d", "—"),
            "browser": v.get("b", "—"),
            "page": v.get("p", "—"),
            "source": v.get("s", "—"),
        }
        for v in recent_raw
    ]

    return _response(200, {
        "visits": _to_int(item.get("visits")),
        "unique": _to_int(item.get("uniqueVisits")),
        "today": day_counts.get(_today(), 0),
        "activeNow": active_now,
        "days": days,
        "devices": devices,
        "browsers": browsers,
        "pages": pages,
        "sources": sources,
        "recent": recent,
    })


# ---------------------------------------------------------------------------
# Lambda entry point
# ---------------------------------------------------------------------------
def lambda_handler(event, context):
    """Route the request: CORS preflight, read snapshot, or record a visit."""
    http_method = (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or "GET"
    )

    if http_method == "OPTIONS":
        return _response(200, {"message": "CORS preflight OK"})

    query_params = event.get("queryStringParameters") or {}

    try:
        if query_params.get("mode") == "read":
            return _read_stats()
        return _record_visit(event, query_params)

    except ClientError as error:
        logger.error("DynamoDB ClientError (%s): %s",
                     error.response["Error"]["Code"], error)
        return _response(500, {"error": "Unable to update visitor data."})

    except BotoCoreError as error:
        logger.error("BotoCoreError: %s", error)
        return _response(500, {"error": "Unable to reach the database."})

    except Exception as error:  # noqa: BLE001 — final safety net
        logger.exception("Unexpected error: %s", error)
        return _response(500, {"error": "An unexpected error occurred."})
