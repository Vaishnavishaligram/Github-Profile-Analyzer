const { pool } = require("../config/db");
const {
  fetchUserProfile,
  fetchUserRepos,
  aggregateRepoInsights,
  computeActivityScore,
} = require("../config/githubService");

// 
// Helper: log every analysis action
// 
async function writeLog(username, action, ip, responseMs, status, errorMsg = null) {
  try {
    await pool.execute(
      `INSERT INTO analysis_log
         (username, action, ip_address, response_ms, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [username, action, ip, responseMs, status, errorMsg]
    );
  } catch {
    // non-critical — swallow silently
  }
}

//
// Helper: upsert a full profile inside a DB transaction
// 
async function upsertProfile(ghUser, repos) {
  const {
    totalStars,
    totalForks,
    totalWatchers,
    topRepos,
    languageMap,
  } = aggregateRepoInsights(repos);

  const activityScore = computeActivityScore(
    ghUser.followers,
    totalStars,
    ghUser.public_repos
  );

  const createdAt = ghUser.created_at ? new Date(ghUser.created_at) : null;
  const accountAgeDays = createdAt
    ? Math.floor((Date.now() - createdAt.getTime()) / 86_400_000)
    : 0;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    //  1. Upsert main profile row 
    const [upsert] = await conn.execute(
      `INSERT INTO github_profiles
         (github_id, username, display_name, bio, company, location, email,
          blog_url, twitter_handle, avatar_url, github_url, account_type,
          public_repos, public_gists, followers, following,
          total_stars, total_forks, total_watchers,
          account_age_days, activity_score, hireable,
          github_created_at, github_updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         display_name       = VALUES(display_name),
         bio                = VALUES(bio),
         company            = VALUES(company),
         location           = VALUES(location),
         email              = VALUES(email),
         blog_url           = VALUES(blog_url),
         twitter_handle     = VALUES(twitter_handle),
         avatar_url         = VALUES(avatar_url),
         account_type       = VALUES(account_type),
         public_repos       = VALUES(public_repos),
         public_gists       = VALUES(public_gists),
         followers          = VALUES(followers),
         following          = VALUES(following),
         total_stars        = VALUES(total_stars),
         total_forks        = VALUES(total_forks),
         total_watchers     = VALUES(total_watchers),
         account_age_days   = VALUES(account_age_days),
         activity_score     = VALUES(activity_score),
         hireable           = VALUES(hireable),
         github_updated_at  = VALUES(github_updated_at),
         last_analyzed_at   = CURRENT_TIMESTAMP`,
      [
        ghUser.id,
        ghUser.login,
        ghUser.name,
        ghUser.bio,
        ghUser.company,
        ghUser.location,
        ghUser.email,
        ghUser.blog || null,
        ghUser.twitter_username || null,
        ghUser.avatar_url,
        ghUser.html_url,
        ghUser.type || "User",
        ghUser.public_repos,
        ghUser.public_gists,
        ghUser.followers,
        ghUser.following,
        totalStars,
        totalForks,
        totalWatchers,
        accountAgeDays,
        activityScore,
        ghUser.hireable ? 1 : 0,
        createdAt,
        ghUser.updated_at ? new Date(ghUser.updated_at) : null,
      ]
    );

    // Resolve the profile's internal id
    let profileId =
      upsert.insertId ||
      (await conn
        .execute("SELECT id FROM github_profiles WHERE username = ?", [ghUser.login])
        .then(([r]) => r[0]?.id));

    //  2. Replace top repositories 
    await conn.execute(
      "DELETE FROM profile_repositories WHERE profile_id = ?",
      [profileId]
    );

    if (topRepos.length) {
      const repoPlaceholders = topRepos.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
      const repoValues = topRepos.flatMap((r) => [
        profileId,
        r.name,
        r.full_name,
        r.description,
        r.language,
        r.stargazers_count || 0,
        r.forks_count || 0,
        r.watchers_count || 0,
        r.open_issues_count || 0,
        r.fork ? 1 : 0,
        r.html_url,
        r.created_at ? new Date(r.created_at) : null,
      ]);

      await conn.execute(
        `INSERT INTO profile_repositories
           (profile_id, repo_name, full_name, description, language,
            stars, forks, watchers, open_issues, is_fork, repo_url, created_at)
         VALUES ${repoPlaceholders}`,
        repoValues
      );
    }

    //  3. Replace language breakdown 
    await conn.execute(
      "DELETE FROM profile_languages WHERE profile_id = ?",
      [profileId]
    );

    const langEntries = Object.entries(languageMap);
    if (langEntries.length) {
      const totalLangRepos = langEntries.reduce((s, [, c]) => s + c, 0);
      const langPlaceholders = langEntries.map(() => "(?,?,?,?)").join(",");
      const langValues = langEntries.flatMap(([lang, count]) => [
        profileId,
        lang,
        count,
        parseFloat(((count / totalLangRepos) * 100).toFixed(2)),
      ]);

      await conn.execute(
        `INSERT INTO profile_languages (profile_id, language, repo_count, percentage)
         VALUES ${langPlaceholders}`,
        langValues
      );
    }

    await conn.commit();
    return profileId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

//
// Helper: load a full profile record from DB
// 
async function loadFullProfile(identifier, byId = false) {
  const whereClause = byId ? "p.id = ?" : "p.username = ?";

  const [[profile]] = await pool.execute(
    `SELECT * FROM github_profiles p WHERE ${whereClause}`,
    [identifier]
  );
  if (!profile) return null;

  const [repositories] = await pool.execute(
    `SELECT repo_name, full_name, description, language, stars, forks,
            watchers, open_issues, is_fork, repo_url, created_at
     FROM profile_repositories
     WHERE profile_id = ?
     ORDER BY stars DESC`,
    [profile.id]
  );

  const [languages] = await pool.execute(
    `SELECT language, repo_count, percentage
     FROM profile_languages
     WHERE profile_id = ?
     ORDER BY repo_count DESC`,
    [profile.id]
  );

  return { ...profile, top_repositories: repositories, languages };
}

// 
// CONTROLLERS
// 

/**
 * POST /api/analyze/:username
 * Fetch GitHub profile, persist to DB, return full insight object.
 */
async function analyzeProfile(req, res) {
  const start = Date.now();
  const { username } = req.params;
  const ip = req.ip;

  if (!/^[a-zA-Z0-9-]{1,39}$/.test(username)) {
    return res.status(400).json({ success: false, message: "Invalid GitHub username format." });
  }

  try {
    const [ghUser, repos] = await Promise.all([
      fetchUserProfile(username),
      fetchUserRepos(username),
    ]);

    await upsertProfile(ghUser, repos);

    const profile = await loadFullProfile(ghUser.login);
    const isNew = Date.now() - new Date(profile.created_at).getTime() < 5000;

    await writeLog(username, isNew ? "created" : "refreshed", ip, Date.now() - start, "success");

    // Invalidate cache for this profile
    if (res.setCache) res.setCache({ success: true, data: profile });

    return res.status(isNew ? 201 : 200).json({
      success: true,
      message: isNew ? "Profile analyzed and stored." : "Profile refreshed.",
      data: profile,
    });
  } catch (err) {
    await writeLog(username, "created", ip, Date.now() - start, "error", err.message);

    if (err.response?.status === 404) {
      return res.status(404).json({ success: false, message: `GitHub user '${username}' not found.` });
    }
    if (err.response?.status === 403) {
      return res.status(429).json({ success: false, message: "GitHub API rate limit exceeded. Add a GITHUB_TOKEN to increase limits." });
    }

    console.error("[analyzeProfile]", err.message);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
}

/**
 * GET /api/profiles
 * Return all stored profiles with optional sorting/pagination.
 */
async function getAllProfiles(req, res) {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const allowedSort = ["followers", "total_stars", "public_repos", "activity_score", "last_analyzed_at"];
    const sortBy = allowedSort.includes(req.query.sort) ? req.query.sort : "last_analyzed_at";
    const order  = req.query.order === "asc" ? "ASC" : "DESC";

    const search = req.query.search ? `%${req.query.search}%` : null;
    const whereClause = search
      ? "WHERE username LIKE ? OR display_name LIKE ? OR location LIKE ?"
      : "";
    const whereParams = search ? [search, search, search] : [];

    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM github_profiles ${whereClause}`,
      whereParams
    );

    const [profiles] = await pool.execute(
      `SELECT id, github_id, username, display_name, bio, avatar_url,
              github_url, location, public_repos, followers, following,
              total_stars, total_forks, activity_score, account_age_days,
              last_analyzed_at
       FROM github_profiles ${whereClause}
       ORDER BY ${sortBy} ${order}
       LIMIT ? OFFSET ?`,
      [...whereParams, limit, offset]
    );

    if (res.setCache) {
      res.setCache({ success: true, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }, data: profiles });
    }

    return res.json({
      success: true,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      data: profiles,
    });
  } catch (err) {
    console.error("[getAllProfiles]", err.message);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
}

/**
 * GET /api/profiles/:username
 * Return a single stored profile with repos and languages.
 */
async function getProfile(req, res) {
  const start = Date.now();
  const { username } = req.params;
  const ip = req.ip;

  try {
    const profile = await loadFullProfile(username);

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: `Profile '${username}' not found. Use POST /api/analyze/${username} to analyze it first.`,
      });
    }

    await writeLog(username, "fetched", ip, Date.now() - start, "success");

    if (res.setCache) res.setCache({ success: true, data: profile });

    return res.json({ success: true, data: profile });
  } catch (err) {
    console.error("[getProfile]", err.message);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
}

/**
 * DELETE /api/profiles/:username
 * Remove a stored profile and all related data.
 */
async function deleteProfile(req, res) {
  const { username } = req.params;

  try {
    const [[row]] = await pool.execute(
      "SELECT id FROM github_profiles WHERE username = ?",
      [username]
    );

    if (!row) {
      return res.status(404).json({ success: false, message: `Profile '${username}' not found.` });
    }

    await pool.execute("DELETE FROM github_profiles WHERE id = ?", [row.id]);

    return res.json({ success: true, message: `Profile '${username}' deleted successfully.` });
  } catch (err) {
    console.error("[deleteProfile]", err.message);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
}

/**
 * GET /api/profiles/:username/repos
 * Return stored repositories for a user.
 */
async function getProfileRepos(req, res) {
  const { username } = req.params;

  try {
    const [[profile]] = await pool.execute(
      "SELECT id FROM github_profiles WHERE username = ?",
      [username]
    );

    if (!profile) {
      return res.status(404).json({ success: false, message: `Profile '${username}' not found.` });
    }

    const [repos] = await pool.execute(
      `SELECT * FROM profile_repositories WHERE profile_id = ? ORDER BY stars DESC`,
      [profile.id]
    );

    return res.json({ success: true, count: repos.length, data: repos });
  } catch (err) {
    console.error("[getProfileRepos]", err.message);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
}

/**
 * GET /api/profiles/:username/languages
 * Return stored language breakdown for a user.
 */
async function getProfileLanguages(req, res) {
  const { username } = req.params;

  try {
    const [[profile]] = await pool.execute(
      "SELECT id FROM github_profiles WHERE username = ?",
      [username]
    );

    if (!profile) {
      return res.status(404).json({ success: false, message: `Profile '${username}' not found.` });
    }

    const [languages] = await pool.execute(
      `SELECT language, repo_count, percentage
       FROM profile_languages WHERE profile_id = ? ORDER BY repo_count DESC`,
      [profile.id]
    );

    return res.json({ success: true, count: languages.length, data: languages });
  } catch (err) {
    console.error("[getProfileLanguages]", err.message);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
}

/**
 * GET /api/stats
 * Aggregate statistics across all stored profiles.
 */
async function getGlobalStats(req, res) {
  try {
    const [[stats]] = await pool.execute(`
      SELECT
        COUNT(*)                         AS total_profiles,
        SUM(followers)                   AS total_followers,
        SUM(total_stars)                 AS total_stars,
        SUM(public_repos)                AS total_repos,
        ROUND(AVG(followers), 2)         AS avg_followers,
        ROUND(AVG(total_stars), 2)       AS avg_stars,
        ROUND(AVG(activity_score), 2)    AS avg_activity_score,
        MAX(followers)                   AS max_followers,
        MAX(total_stars)                 AS max_stars,
        MIN(last_analyzed_at)            AS oldest_analysis,
        MAX(last_analyzed_at)            AS newest_analysis
      FROM github_profiles
    `);

    const [topByStars] = await pool.execute(
      `SELECT username, display_name, total_stars, avatar_url
       FROM github_profiles ORDER BY total_stars DESC LIMIT 5`
    );

    const [topByFollowers] = await pool.execute(
      `SELECT username, display_name, followers, avatar_url
       FROM github_profiles ORDER BY followers DESC LIMIT 5`
    );

    const [popularLanguages] = await pool.execute(`
      SELECT language, SUM(repo_count) AS total_repos
      FROM profile_languages
      GROUP BY language
      ORDER BY total_repos DESC
      LIMIT 10
    `);

    if (res.setCache) {
      res.setCache({ success: true, data: { ...stats, topByStars, topByFollowers, popularLanguages } });
    }

    return res.json({
      success: true,
      data: {
        ...stats,
        top_by_stars: topByStars,
        top_by_followers: topByFollowers,
        popular_languages: popularLanguages,
      },
    });
  } catch (err) {
    console.error("[getGlobalStats]", err.message);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
}

/**
 * GET /api/logs
 * Return recent analysis log entries.
 */
async function getLogs(req, res) {
  try {
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const [logs] = await pool.execute(
      `SELECT * FROM analysis_log ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    return res.json({ success: true, count: logs.length, data: logs });
  } catch (err) {
    console.error("[getLogs]", err.message);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
}

module.exports = {
  analyzeProfile,
  getAllProfiles,
  getProfile,
  deleteProfile,
  getProfileRepos,
  getProfileLanguages,
  getGlobalStats,
  getLogs,
};
