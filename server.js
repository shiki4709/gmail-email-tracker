// Email Tracker Server
// Run: node server.js

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

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // POST /register — store email metadata when sending
  if (url.pathname === "/register" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { trackingId, recipient, subject } = JSON.parse(body);
        const db = loadDB();
        db[trackingId] = {
          recipient: recipient || "unknown",
          subject: subject || "(no subject)",
          registeredAt: new Date().toISOString(),
          opens: [],
        };
        saveDB(db);
        console.log(`[REGISTERED] ${trackingId} → ${recipient} | ${subject}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // GET /track?id=xxx — tracking pixel endpoint
  if (url.pathname === "/track") {
    const trackingId = url.searchParams.get("id");
    if (trackingId) {
      const db = loadDB();
      if (!db[trackingId]) {
        db[trackingId] = { recipient: "unknown", subject: "unknown", opens: [] };
      }
      db[trackingId].opens.push({
        timestamp: new Date().toISOString(),
        userAgent: req.headers["user-agent"] || "unknown",
        ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
      });
      saveDB(db);

      const entry = db[trackingId];
      console.log(
        `[OPEN] ${entry.recipient} | "${entry.subject}" | ${entry.opens.length} total opens`
      );
    }

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

  // GET /opens — list all tracked emails with open data
  // GET /opens?id=xxx — get specific tracking entry
  if (url.pathname === "/opens") {
    const trackingId = url.searchParams.get("id");
    const db = loadDB();

    if (trackingId) {
      const entry = db[trackingId];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          entry
            ? {
                trackingId,
                recipient: entry.recipient || "unknown",
                subject: entry.subject || "unknown",
                openCount: entry.opens.length,
                opens: entry.opens,
              }
            : { trackingId, recipient: "unknown", subject: "unknown", openCount: 0, opens: [] }
        )
      );
    } else {
      // Return all with full info
      const summary = Object.entries(db).map(([id, data]) => ({
        trackingId: id,
        recipient: data.recipient || "unknown",
        subject: data.subject || "unknown",
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

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Email Tracker Server Running");
});

const PORT = process.env.PORT || 3100;
process.stdout.write("\033]0;Gmail Email Tracker\007");
server.listen(PORT, () => {
  console.log(`Email tracker running on http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /register  — register email metadata`);
  console.log(`  GET  /track?id= — tracking pixel`);
  console.log(`  GET  /opens     — all tracked emails`);
  console.log(`  GET  /opens?id= — specific email\n`);
});
