/**
 * Website Visitor Counter — Frontend Logic
 *
 * On page load, this script calls the API Gateway endpoint, which invokes
 * an AWS Lambda function that atomically increments the visitor count in
 * DynamoDB and returns the latest value.
 *
 * Replace API_URL below with your deployed API Gateway invoke URL, e.g.:
 * https://abc123xyz.execute-api.us-east-1.amazonaws.com/visitor-count
 */

const API_URL = "PASTE_API_GATEWAY_URL";

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
 * Fetch the latest visitor count from the API Gateway endpoint.
 * Uses AbortController so a hung request doesn't leave the spinner forever.
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(API_URL, {
            method: "GET",
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
