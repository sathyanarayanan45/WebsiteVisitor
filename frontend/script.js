/**
 * Website Insights — Frontend Logic
 *
 * Pages:
 *   - visit.html  → records a visit with metadata (page, source, unique flag);
 *                   the Lambda adds device/browser from the User-Agent
 *   - index.html  → analytics dashboard: polls ?mode=read every 5 seconds and
 *                   renders stat cards, charts, top lists, a recent-visitors
 *                   table, and client-side API health metrics
 *
 * Page flags (set before this script loads):
 *   window.COUNTER_MODE = "read"   → don't record (dashboard)
 *   window.DASHBOARD    = true     → enable polling + dashboard rendering
 *   window.SHOW_COUNT   = false    → show a confirmation instead of a number
 */

const API_URL = "https://ndcfh75n8b.execute-api.us-east-1.amazonaws.com/visitor-count";

const IS_DASHBOARD = window.DASHBOARD === true || window.COUNTER_MODE === "read";

const REQUEST_TIMEOUT_MS = 10000; // give up on a request after 10s
const POLL_INTERVAL_MS = 5000;    // dashboard refresh rate

// ---- Shared elements -------------------------------------------------------
const loaderElement = document.getElementById("loader");
const counterElement = document.getElementById("visitor-count");
const errorElement = document.getElementById("error-message");

// ---- Dashboard elements (null on visit.html) --------------------------------
const el = (id) => document.getElementById(id);
const lastUpdatedElement = el("last-updated");
const nextRefreshElement = el("next-refresh");
const statusTextElement = el("api-status");
const statusDotElement = el("status-dot");

// ---- Session / monitoring state ---------------------------------------------
let pollsTotal = 0;
let pollsSucceeded = 0;
let latencySamples = [];
const LATENCY_LIMIT = 20;
let secondsToRefresh = POLL_INTERVAL_MS / 1000;
let hasLoadedOnce = false;

// Colour palette for charts (matches the CSS theme)
const CHART_COLORS = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#f87171"];

/* ===========================================================================
   Low-level API call
   =========================================================================== */

/** Call the API and return { data, latencyMs }. */
async function callApi(params) {
    const query = new URLSearchParams(params).toString();
    const url = query ? `${API_URL}?${query}` : API_URL;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const startedAt = performance.now();

    try {
        const response = await fetch(url, {
            method: "GET",
            cache: "no-store", // never serve stale analytics
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`API responded with status ${response.status}`);
        }

        const data = await response.json();

        if (typeof data.visits !== "number") {
            throw new Error("Unexpected API response: missing 'visits' field");
        }

        return { data, latencyMs: performance.now() - startedAt };
    } finally {
        clearTimeout(timeoutId);
    }
}

/** Guard against common configuration mistakes. */
function configurationError() {
    if (API_URL === "PASTE_API_GATEWAY_URL") {
        console.error("API_URL is not configured. Paste your API Gateway invoke URL into script.js.");
        return true;
    }
    if (API_URL.includes(".s3.") || API_URL.includes("s3-website")) {
        console.error("API_URL points to S3, not API Gateway. Use the execute-api invoke URL.");
        return true;
    }
    return false;
}

/* ===========================================================================
   Visit page flow (visit.html)
   =========================================================================== */

/** Classify document.referrer into a friendly traffic source. */
function classifySource() {
    const ref = document.referrer.toLowerCase();
    if (!ref) return "Direct";
    if (ref.includes("google.") || ref.includes("bing.") || ref.includes("duckduckgo")) return "Search";
    if (ref.includes("facebook.") || ref.includes("instagram.") || ref.includes("twitter.")
        || ref.includes("t.co") || ref.includes("linkedin.") || ref.includes("youtube.")
        || ref.includes("whatsapp")) return "Social";
    if (ref.includes(location.hostname)) return "Internal";
    return "Referral";
}

/** True the first time this browser ever visits (tracked via localStorage). */
function isFirstVisit() {
    try {
        if (localStorage.getItem("wi_visited")) {
            return false;
        }
        localStorage.setItem("wi_visited", "1");
        return true;
    } catch (error) {
        return false; // storage blocked (private mode) — count as returning
    }
}

/** Record the visit, then show a confirmation. */
async function runVisitPage() {
    try {
        const params = {
            page: location.pathname || "/",
            src: classifySource(),
        };
        if (isFirstVisit()) {
            params.new = "1";
        }

        await callApi(params);

        loaderElement.classList.add("hidden");
        errorElement.classList.add("hidden");
        counterElement.textContent = "✓ Your visit has been recorded";
        counterElement.classList.add("confirmation");
        counterElement.classList.remove("hidden");
    } catch (error) {
        console.error("Failed to record visit:", error);
        loaderElement.classList.add("hidden");
        counterElement.classList.add("hidden");
        errorElement.classList.remove("hidden");
    }
}

/* ===========================================================================
   Dashboard rendering
   =========================================================================== */

/** Set a stat card value with locale formatting. */
function setStat(id, value) {
    const element = el(id);
    if (element) {
        element.textContent = value.toLocaleString();
    }
}

/** Render the 7-day line chart. */
function drawDaysChart(days) {
    const canvas = el("days-chart");
    if (!canvas || !days || days.length === 0) return;

    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const padX = 40, padY = 24;

    ctx.clearRect(0, 0, W, H);

    const counts = days.map((d) => d.count);
    const max = Math.max(...counts, 1);
    const stepX = (W - padX * 2) / (days.length - 1);
    const toX = (i) => padX + i * stepX;
    const toY = (v) => H - padY - (v / max) * (H - padY * 2);

    // Horizontal gridlines
    ctx.strokeStyle = "rgba(139,147,163,0.15)";
    ctx.lineWidth = 1;
    for (let g = 0; g <= 2; g++) {
        const y = padY + (g / 2) * (H - padY * 2);
        ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(W - padX, y); ctx.stroke();
    }

    // Area fill
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(counts[0]));
    counts.forEach((v, i) => ctx.lineTo(toX(i), toY(v)));
    ctx.lineTo(toX(counts.length - 1), H - padY);
    ctx.lineTo(toX(0), H - padY);
    ctx.closePath();
    ctx.fillStyle = "rgba(52,211,153,0.12)";
    ctx.fill();

    // Line + points
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(counts[0]));
    counts.forEach((v, i) => ctx.lineTo(toX(i), toY(v)));
    ctx.strokeStyle = "#34d399";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#34d399";
    counts.forEach((v, i) => {
        ctx.beginPath(); ctx.arc(toX(i), toY(v), 3, 0, Math.PI * 2); ctx.fill();
    });

    // Labels: day names under each point, count above
    ctx.fillStyle = "#8b93a3";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    days.forEach((d, i) => {
        const label = new Date(`${d.date}T00:00:00Z`)
            .toLocaleDateString(undefined, { weekday: "short" });
        ctx.fillText(label, toX(i), H - 6);
        if (d.count > 0) {
            ctx.fillText(String(d.count), toX(i), toY(d.count) - 8);
        }
    });
}

/** Render the device pie chart + legend. */
function drawDevicePie(devices) {
    const canvas = el("device-pie");
    const legend = el("device-legend");
    if (!canvas || !legend) return;

    const entries = Object.entries(devices || {}).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, v]) => sum + v, 0);
    if (total === 0) return;

    const ctx = canvas.getContext("2d");
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const radius = Math.min(cx, cy) - 4;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let angle = -Math.PI / 2;

    legend.innerHTML = "";
    entries.forEach(([name, value], i) => {
        const slice = (value / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, angle, angle + slice);
        ctx.closePath();
        ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
        ctx.fill();
        angle += slice;

        const li = document.createElement("li");
        const pct = ((value / total) * 100).toFixed(0);
        li.innerHTML =
            `<span class="swatch" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>` +
            `${name} — ${value.toLocaleString()} (${pct}%)`;
        legend.appendChild(li);
    });
}

/** Render horizontal browser bars. */
function drawBrowserBars(browsers) {
    const wrap = el("browser-bars");
    if (!wrap) return;

    const entries = Object.entries(browsers || {}).sort((a, b) => b[1] - a[1]);
    const max = entries.length ? entries[0][1] : 0;
    if (max === 0) return;

    wrap.innerHTML = "";
    entries.forEach(([name, value], i) => {
        const row = document.createElement("div");
        row.className = "bar-row";
        row.innerHTML =
            `<span class="bar-name">${name}</span>` +
            `<span class="bar-track"><span class="bar-fill" style="width:${(value / max) * 100}%;` +
            `background:${CHART_COLORS[i % CHART_COLORS.length]}"></span></span>` +
            `<span class="bar-count">${value.toLocaleString()}</span>`;
        wrap.appendChild(row);
    });
}

/** Render a ranked list (Top Pages / Traffic Sources) with percentages. */
function drawRankList(id, map) {
    const list = el(id);
    if (!list) return;

    const entries = Object.entries(map || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const total = entries.reduce((sum, [, v]) => sum + v, 0);
    if (total === 0) return;

    list.innerHTML = "";
    entries.forEach(([name, value]) => {
        const li = document.createElement("li");
        const pct = ((value / total) * 100).toFixed(0);
        li.innerHTML =
            `<span class="rank-name">${name}</span>` +
            `<span class="rank-value">${value.toLocaleString()} · ${pct}%</span>`;
        list.appendChild(li);
    });
}

/** Render the recent visitors table. */
function drawRecentTable(recent) {
    const body = el("recent-body");
    if (!body) return;
    if (!recent || recent.length === 0) return;

    body.innerHTML = "";
    recent.forEach((visit) => {
        const row = document.createElement("tr");
        const when = new Date(visit.time * 1000).toLocaleTimeString();
        row.innerHTML =
            `<td>${when}</td><td>${visit.source}</td><td>${visit.device}</td>` +
            `<td>${visit.browser}</td><td>${visit.page}</td>`;
        body.appendChild(row);
    });
}

/** Update the API health panel (client-side session metrics). */
function updateHealth(healthy, latencyMs) {
    if (lastUpdatedElement) {
        lastUpdatedElement.textContent = new Date().toLocaleTimeString();
    }
    if (statusTextElement && statusDotElement) {
        statusTextElement.textContent = healthy ? "Operational" : "Reconnecting…";
        statusDotElement.classList.toggle("dot-down", !healthy);
    }

    setStat("health-requests", pollsTotal);
    setStat("health-success", pollsSucceeded);
    setStat("health-failed", pollsTotal - pollsSucceeded);

    if (typeof latencyMs === "number") {
        latencySamples.push(latencyMs);
        if (latencySamples.length > LATENCY_LIMIT) {
            latencySamples.shift();
        }
    }
    const latencyElement = el("health-latency");
    if (latencyElement && latencySamples.length > 0) {
        const avg = latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length;
        latencyElement.textContent = `${Math.round(avg)} ms`;
    }
}

/** Render everything from one analytics snapshot. */
function renderDashboard(data) {
    if (loaderElement) {
        loaderElement.classList.add("hidden");
    }
    if (errorElement) {
        errorElement.classList.add("hidden");
    }

    setStat("stat-visits", data.visits);
    setStat("stat-unique", data.unique ?? 0);
    setStat("stat-today", data.today ?? 0);
    setStat("stat-active", data.activeNow ?? 0);

    const todayDate = el("today-date");
    if (todayDate) {
        todayDate.textContent = new Date().toLocaleDateString(
            undefined, { day: "numeric", month: "short" });
    }

    drawDaysChart(data.days);
    drawDevicePie(data.devices);
    drawBrowserBars(data.browsers);
    drawRankList("top-pages", data.pages);
    drawRankList("traffic-sources", data.sources);
    drawRecentTable(data.recent);
}

/* ===========================================================================
   Dashboard polling loop
   =========================================================================== */

/** One dashboard poll: fetch the snapshot, render, update health. */
async function pollOnce() {
    pollsTotal += 1;
    secondsToRefresh = POLL_INTERVAL_MS / 1000;

    try {
        const { data, latencyMs } = await callApi({ mode: "read" });
        pollsSucceeded += 1;
        hasLoadedOnce = true;
        renderDashboard(data);
        updateHealth(true, latencyMs);
    } catch (error) {
        console.error("Poll failed:", error);
        if (!hasLoadedOnce && errorElement) {
            errorElement.classList.remove("hidden"); // nothing loaded yet
            if (loaderElement) {
                loaderElement.classList.add("hidden");
            }
        }
        updateHealth(false);
    }
}

/** Tick the "next refresh" countdown once per second. */
function startRefreshCountdown() {
    if (!nextRefreshElement) return;
    setInterval(() => {
        secondsToRefresh -= 1;
        if (secondsToRefresh <= 0) {
            secondsToRefresh = POLL_INTERVAL_MS / 1000;
        }
        nextRefreshElement.textContent = `${secondsToRefresh}s`;
    }, 1000);
}

async function runDashboard() {
    await pollOnce();
    setInterval(pollOnce, POLL_INTERVAL_MS);
    startRefreshCountdown();
}

/* ===========================================================================
   Entry point
   =========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
    if (configurationError()) {
        if (loaderElement) loaderElement.classList.add("hidden");
        if (errorElement) errorElement.classList.remove("hidden");
        return;
    }

    if (IS_DASHBOARD) {
        runDashboard();
    } else {
        runVisitPage();
    }
});
