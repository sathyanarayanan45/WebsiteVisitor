/**
 * Website Visitor Counter — Frontend Logic
 *
 * Shared by both pages:
 *   - visit.html  → "increment" mode: counts the visit, then shows the total
 *   - index.html  → "read" mode: shows the total WITHOUT counting a visit
 *
 * Each page sets its mode before loading this script:
 *   <script>window.COUNTER_MODE = "read";</script>
 * If no mode is set, "increment" is the default.
 *
 * Replace API_URL below with your deployed API Gateway invoke URL, e.g.:
 * https://abc123xyz.execute-api.us-east-1.amazonaws.com/visitor-count
 * (NOT the S3 website URL — it must be the execute-api URL.)
 */

const API_URL = "PASTE_API_GATEWAY_URL";

// "read" = display only, "increment" = count this page view
const PAGE_MODE = window.COUNTER_MODE === "read" ? "read" : "increment";

// How long to wait for the API before giving up (milliseconds)
const REQUEST_TIMEOUT_MS = 10000;

// DOM elements
const loaderElement = document.getElementById("loader");
const counterElement = document.getElementById("visitor-count");
const errorElement = document.getElementById("error-message");

/**
 * Show the visitor count and hide the loader / error message.
 * @param {number} visits - The total visitor count returned by the API.
 */
function showCount(visits) {
    counterElement.textContent = visits.toLocaleString();
    loaderElement.classList.add("hidden");
    errorElement.classList.add("hidden");
    counterElement.classList.remove("hidden");
}

/**
 * Show the "Counter unavailable" error message and hide the loader.
 */
function showError() {
    loaderElement.classList.add("hidden");
    counterElement.classList.add("hidden");
    errorElement.classList.remove("hidden");
}

/**
 * Fetch the visitor count from the API Gateway endpoint.
 * In "read" mode a ?mode=read query parameter tells the Lambda
 * to return the count without incrementing it.
 */
async function fetchVisitorCount() {
    // Guard: warn clearly if the API URL was never configured
    if (API_URL === "PASTE_API_GATEWAY_URL") {
        console.error(
            "API_URL is not configured. Paste your API Gateway invoke URL into script.js."
        );
        showError();
        return;
    }

    // Guard: catch the common mistake of pasting the S3 website URL
    if (API_URL.includes(".s3.") || API_URL.includes("s3-website")) {
        console.error(
            "API_URL points to S3, not API Gateway. Use the execute-api invoke URL, " +
            "e.g. https://abc123.execute-api.us-east-1.amazonaws.com/visitor-count"
        );
        showError();
        return;
    }

    const requestUrl =
        PAGE_MODE === "read" ? `${API_URL}?mode=read` : API_URL;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(requestUrl, {
            method: "GET",
            cache: "no-store", // never serve a stale cached count
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`API responded with status ${response.status}`);
        }

        const data = await response.json();

        // Validate the response shape before displaying it
        if (typeof data.visits !== "number") {
            throw new Error("Unexpected API response: missing 'visits' field");
        }

        showCount(data.visits);
    } catch (error) {
        console.error("Failed to fetch visitor count:", error);
        showError();
    } finally {
        clearTimeout(timeoutId);
    }
}

// Fetch the count as soon as the page loads
document.addEventListener("DOMContentLoaded", fetchVisitorCount);
