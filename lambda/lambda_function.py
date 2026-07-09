"""
Website Visitor Counter — AWS Lambda Function

Runtime: Python 3.12

Invoked by API Gateway (HTTP API, GET /visitor-count). Atomically increments
the visitor count stored in DynamoDB and returns the latest value as JSON:

    { "visits": 25 }

DynamoDB table:
    Name:           WebsiteVisitorCounter
    Partition key:  counterId (String)
    Counter item:   { "counterId": "main", "visits": <number> }

The atomic "ADD visits :inc" update expression means:
  - If the item doesn't exist, DynamoDB creates it with visits = 1.
  - Concurrent requests never lose increments (no read-modify-write race).
"""

import json
import logging

import boto3
from botocore.exceptions import BotoCoreError, ClientError

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TABLE_NAME = "WebsiteVisitorCounter"
COUNTER_ID = "main"

# CORS headers so the static website (any origin) can call this API
CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
}

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize outside the handler so the connection is reused across
# warm Lambda invocations (better performance, fewer connections).
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)


def lambda_handler(event, context):
    """
    Lambda entry point.

    Increments the visitor counter atomically and returns the new total.
    Handles CORS preflight (OPTIONS) requests as well.
    """
    # --- Handle CORS preflight requests -----------------------------------
    # HTTP API (payload v2.0) puts the method under requestContext.http.method;
    # REST API (payload v1.0) uses httpMethod. Support both defensively.
    http_method = (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or "GET"
    )

    if http_method == "OPTIONS":
        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps({"message": "CORS preflight OK"}),
        }

    # --- Increment the counter atomically ---------------------------------
    try:
        response = table.update_item(
            Key={"counterId": COUNTER_ID},
            # Atomic counter: ADD creates the attribute (and the item)
            # if it doesn't exist yet, starting from 0.
            UpdateExpression="ADD visits :inc",
            ExpressionAttributeValues={":inc": 1},
            ReturnValues="UPDATED_NEW",
        )

        # DynamoDB returns numbers as Decimal — convert to int for JSON
        updated_visits = int(response["Attributes"]["visits"])

        logger.info("Visitor count incremented to %d", updated_visits)

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps({"visits": updated_visits}),
        }

    except ClientError as error:
        # AWS service errors (table missing, permissions, throttling, ...)
        error_code = error.response["Error"]["Code"]
        logger.error("DynamoDB ClientError (%s): %s", error_code, error)
        return _error_response(
            "Unable to update visitor count. Please try again later."
        )

    except BotoCoreError as error:
        # Lower-level boto3/network errors
        logger.error("BotoCoreError: %s", error)
        return _error_response(
            "Unable to reach the database. Please try again later."
        )

    except Exception as error:  # noqa: BLE001 — final safety net
        # Anything unexpected: log it, but never leak internals to the client
        logger.exception("Unexpected error: %s", error)
        return _error_response("An unexpected error occurred.")


def _error_response(message):
    """Build a JSON error response with CORS headers."""
    return {
        "statusCode": 500,
        "headers": CORS_HEADERS,
        "body": json.dumps({"error": message}),
    }
