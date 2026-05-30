require("dotenv").config();

const express = require("express");
const cors    = require("cors");
const { testConnection, pool } = require("./config/db");
const { apiLimiter }     = require("./middleware/rateLimiter");
const githubRoutes       = require("./routes/github");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("trust proxy", 1);
app.use("/api", apiLimiter);
app.use("/api", githubRoutes);

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "github-profile-analyzer",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

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

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found.`,
  });
});

app.use((err, req, res, _next) => {
  console.error("[Unhandled Error]", err.stack);
  res.status(500).json({ success: false, message: "An unexpected error occurred." });
});

// ── Auto-create tables on first boot ──────────────────────────
async function initSchema() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS github_profiles (
      id                    INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
      github_id             BIGINT UNSIGNED NOT NULL UNIQUE,
      username              VARCHAR(100)    NOT NULL UNIQUE,
      display_name          VARCHAR(255),
      bio                   TEXT,
      company               VARCHAR(255),
      location              VARCHAR(255),
      email                 VARCHAR(255),
      blog_url              VARCHAR(512),
      twitter_handle        VARCHAR(100),
      avatar_url            VARCHAR(512),
      github_url            VARCHAR(512)    NOT NULL,
      account_type          ENUM('User','Organization') DEFAULT 'User',
      public_repos          INT UNSIGNED    DEFAULT 0,
      public_gists          INT UNSIGNED    DEFAULT 0,
      followers             INT UNSIGNED    DEFAULT 0,
      following             INT UNSIGNED    DEFAULT 0,
      total_stars           INT UNSIGNED    DEFAULT 0,
      total_forks           INT UNSIGNED    DEFAULT 0,
      total_watchers        INT UNSIGNED    DEFAULT 0,
      account_age_days      INT UNSIGNED    DEFAULT 0,
      activity_score        DECIMAL(8,2)    DEFAULT 0.00,
      hireable              TINYINT(1)      DEFAULT 0,
      github_created_at     DATETIME,
      github_updated_at     DATETIME,
      created_at            DATETIME        DEFAULT CURRENT_TIMESTAMP,
      last_analyzed_at      DATETIME        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_username (username),
      INDEX idx_followers (followers),
      INDEX idx_stars (total_stars)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS profile_repositories (
      id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
      profile_id      INT UNSIGNED    NOT NULL,
      repo_name       VARCHAR(255)    NOT NULL,
      full_name       VARCHAR(512)    NOT NULL,
      description     TEXT,
      language        VARCHAR(100),
      stars           INT UNSIGNED    DEFAULT 0,
      forks           INT UNSIGNED    DEFAULT 0,
      watchers        INT UNSIGNED    DEFAULT 0,
      open_issues     INT UNSIGNED    DEFAULT 0,
      is_fork         TINYINT(1)      DEFAULT 0,
      repo_url        VARCHAR(512),
      created_at      DATETIME,
      updated_at      DATETIME,
      recorded_at     DATETIME        DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (profile_id) REFERENCES github_profiles(id) ON DELETE CASCADE,
      INDEX idx_profile_id (profile_id),
      INDEX idx_stars (stars)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS profile_languages (
      id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
      profile_id      INT UNSIGNED    NOT NULL,
      language        VARCHAR(100)    NOT NULL,
      repo_count      INT UNSIGNED    DEFAULT 1,
      percentage      DECIMAL(5,2)    DEFAULT 0.00,
      recorded_at     DATETIME        DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (profile_id) REFERENCES github_profiles(id) ON DELETE CASCADE,
      UNIQUE KEY uq_profile_lang (profile_id, language),
      INDEX idx_profile_id (profile_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS analysis_log (
      id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
      username        VARCHAR(100)    NOT NULL,
      action          ENUM('created','refreshed','fetched') NOT NULL,
      ip_address      VARCHAR(45),
      response_ms     INT UNSIGNED,
      status          ENUM('success','error') DEFAULT 'success',
      error_message   TEXT,
      created_at      DATETIME        DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_username (username),
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ];

  for (const sql of tables) {
    await pool.execute(sql);
  }
  console.log("✅  Database tables ready");
}

async function start() {
  await testConnection();
  await initSchema();        // ← auto creates all 4 tables
  app.listen(PORT, () => {
    console.log(`\n🚀  GitHub Analyzer API running on http://localhost:${PORT}`);
    console.log(`📋  API docs available at  http://localhost:${PORT}/\n`);
  });
}

start();
