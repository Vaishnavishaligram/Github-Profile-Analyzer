-- 
--  GitHub Profile Analyzer- Database Schema
-- 
CREATE DATABASE IF NOT EXISTS github_analyzer
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE github_analyzer;

-- Core profile snapshots 
CREATE TABLE IF NOT EXISTS github_profiles (
  id                    INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,

  -- Identity
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

  -- Stats
  public_repos          INT UNSIGNED    DEFAULT 0,
  public_gists          INT UNSIGNED    DEFAULT 0,
  followers             INT UNSIGNED    DEFAULT 0,
  following             INT UNSIGNED    DEFAULT 0,
  total_stars           INT UNSIGNED    DEFAULT 0,
  total_forks           INT UNSIGNED    DEFAULT 0,
  total_watchers        INT UNSIGNED    DEFAULT 0,

  -- Computed insights
  account_age_days      INT UNSIGNED    DEFAULT 0,
  activity_score        DECIMAL(8,2)    DEFAULT 0.00 COMMENT 'Weighted engagement score',
  hireable              TINYINT(1)      DEFAULT 0,

  -- Timestamps from GitHub
  github_created_at     DATETIME,
  github_updated_at     DATETIME,

  -- Our metadata
  created_at            DATETIME        DEFAULT CURRENT_TIMESTAMP,
  last_analyzed_at      DATETIME        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_username    (username),
  INDEX idx_followers   (followers),
  INDEX idx_stars       (total_stars)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


--  Top repositories per profile 
CREATE TABLE IF NOT EXISTS profile_repositories (
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
  INDEX idx_stars      (stars)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


--  Language breakdown per profile 
CREATE TABLE IF NOT EXISTS profile_languages (
  id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
  profile_id      INT UNSIGNED    NOT NULL,
  language        VARCHAR(100)    NOT NULL,
  repo_count      INT UNSIGNED    DEFAULT 1,
  percentage      DECIMAL(5,2)    DEFAULT 0.00,
  recorded_at     DATETIME        DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (profile_id) REFERENCES github_profiles(id) ON DELETE CASCADE,
  UNIQUE KEY uq_profile_lang (profile_id, language),
  INDEX idx_profile_id (profile_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


--  Analysis audit log 
CREATE TABLE IF NOT EXISTS analysis_log (
  id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
  username        VARCHAR(100)    NOT NULL,
  action          ENUM('created','refreshed','fetched') NOT NULL,
  ip_address      VARCHAR(45),
  response_ms     INT UNSIGNED,
  status          ENUM('success','error') DEFAULT 'success',
  error_message   TEXT,
  created_at      DATETIME        DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_username   (username),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
