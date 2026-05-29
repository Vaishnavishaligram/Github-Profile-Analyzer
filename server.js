require("dotenv").config();

const express = require("express");
const cors    = require("cors");
const { testConnection } = require("./config/db");
const { apiLimiter }     = require("./middleware/rateLimiter");
const githubRoutes       = require("./routes/github");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Core Middleware ──────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trust proxies (required for rate-limiter to get real IPs behind nginx/etc.)
app.set("trust proxy", 1);

// Global rate limiter
app.use("/api", apiLimiter);

// ── Routes ───────────────────────────────────────────────────
app.use("/api", githubRoutes);

// ── Health check ─────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "github-profile-analyzer",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// ── Root welcome ─────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    service: "GitHub Profile Analyzer API",
    version: "1.0.0",
    endpoints: {
      analyze_profile:   "POST   /api/analyze/:username",
      list_profiles:     "GET    /api/profiles",
      get_profile:       "GET    /api/profiles/:username",
      delete_profile:    "DELETE /api/profiles/:username",
      profile_repos:     "GET    /api/profiles/:username/repos",
      profile_languages: "GET    /api/profiles/:username/languages",
      global_stats:      "GET    /api/stats",
      audit_logs:        "GET    /api/logs",
      health:            "GET    /health",
    },
  });
});

// ── 404 handler ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found.`,
  });
});

// ── Global error handler ─────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error("[Unhandled Error]", err.stack);
  res.status(500).json({ success: false, message: "An unexpected error occurred." });
});

// ── Boot ─────────────────────────────────────────────────────
async function start() {
  await testConnection();
  app.listen(PORT, () => {
    console.log(`\n🚀  GitHub Analyzer API running on http://localhost:${PORT}`);
    console.log(`📋  API docs available at  http://localhost:${PORT}/\n`);
  });
}

start();
