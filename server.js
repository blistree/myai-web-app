const express = require("express");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Proxy API requests to Cloud Function backend
app.all("/api/*", async (req, res) => {
  const targetUrl = `https://api-62x7rip7mq-uc.a.run.app${req.originalUrl}`;
  try {
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    delete headers["content-length"];

    const options = {
      method: req.method,
      headers: {
        ...headers,
        "Content-Type": "application/json"
      }
    };

    if (req.method !== "GET" && req.method !== "HEAD" && req.body && Object.keys(req.body).length > 0) {
      options.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, options);
    const contentType = response.headers.get("content-type");
    if (contentType) {
      res.set("Content-Type", contentType);
    }
    res.status(response.status);
    const data = await response.text();
    res.send(data);
  } catch (err) {
    console.error("API proxy error:", err);
    res.status(500).json({ error: "API proxy error", details: err.message });
  }
});

// Serve static frontend files from public/
app.use(express.static(path.join(__dirname, "public")));

// Fallback to index.html for client-side navigation
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MyAI Sovereign Web Server listening on port ${PORT}`);
});
