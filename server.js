// Lightweight tracking pixel server
// Run: node server.js
// Expose with: npx localtunnel --port 3000 (or ngrok http 3000)

const http = require("http");
const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "opens.json");

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS headers for the extension
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /track?id=xxx — tracking pixel endpoint
  if (url.pathname === "/track") {
    const trackingId = url.searchParams.get("id");
    if (trackingId) {
      const db = loadDB();
      if (!db[trackingId]) {
        db[trackingId] = { opens: [] };
      }
      db[trackingId].opens.push({
        timestamp: new Date().toISOString(),
        userAgent: req.headers["user-agent"] || "unknown",
        ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
      });
      saveDB(db);
      console.log(
        `[OPEN] ${trackingId} — ${db[trackingId].opens.length} total opens`
      );
    }

    // Return the pixel with no-cache headers
    res.writeHead(200, {
      "Content-Type": "image/gif",
      "Content-Length": PIXEL.length,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    });
    res.end(PIXEL);
    return;
  }

  // GET /opens?id=xxx — check opens for a specific tracking ID
  if (url.pathname === "/opens") {
    const trackingId = url.searchParams.get("id");
    const db = loadDB();

    if (trackingId) {
      const entry = db[trackingId];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          entry
            ? { trackingId, openCount: entry.opens.length, opens: entry.opens }
            : { trackingId, openCount: 0, opens: [] }
        )
      );
    } else {
      // Return all tracking data
      const summary = Object.entries(db).map(([id, data]) => ({
        trackingId: id,
        openCount: data.opens.length,
        lastOpen: data.opens.length
          ? data.opens[data.opens.length - 1].timestamp
          : null,
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(summary));
    }
    return;
  }

  // Default
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Email Tracker Server Running");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Email tracker server running on http://localhost:${PORT}`);
  console.log(`Tracking pixel URL: http://localhost:${PORT}/track?id=<ID>`);
  console.log(`Check opens: http://localhost:${PORT}/opens`);
  console.log("");
  console.log("Expose publicly with: npx localtunnel --port 3000");
});
