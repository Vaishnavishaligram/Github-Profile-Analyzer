##Github-Profile-Analyzer
## Project Structure


github-analyzer/
  server.js                    # Entry point
  .env.example                 # Environment variables template
   package.json
   config/
       db.js                    # MySQL connection pool
       githubService.js         # GitHub API calls + data helpers
     controllers/
      githubController.js      # All route handler logic
     middleware/
       rateLimiter.js           # Rate limiting + in-memory cache
     models/
       schema.sql               # Full database schema
     routes/
       github.js                # All API route definitions




## Quick Start

### 1. Clone & install

  ```bash
git clone <repo-url>
cd github-analyzer
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in your MySQL credentials and (optionally) a GitHub token
```

### 3. Create the database

```bash
mysql -u root -p < models/schema.sql
```

### 4. Run the server

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

The API will be available at `http://localhost:3000`.



## API Endpoints

### Analyze a GitHub User

```
POST /api/analyze/:username
```

Fetches the user's public profile and all public repositories from GitHub, computes insights, and stores or refreshes the record in MySQL.




**Response (201 Created ):**
```json
{
  "success": true,
  "message": "Profile analyzed and stored.",
  "data": {
    "id": 1,
    "github_id": 1024025,
    "username": "torvalds",
    "display_name": "Linus Torvalds",
    "bio": "...",
    "location": "Portland, OR",
    "public_repos": 8,
    "followers": 215000,
    "following": 0,
    "total_stars": 195000,
    "total_forks": 56000,
    "activity_score": 95.47,
    "account_age_days": 5670,
    "last_analyzed_at": "2025-01-01T00:00:00.000Z",
    "top_repositories": [...],
    "languages": [...]
  }
}
```

---

### List All Stored Profiles

```
GET /api/profiles
```

**Query parameters:**

| Param    | Default          | Description                                      |
|----------|------------------|--------------------------------------------------|
| `page`   | `1`              | Page number                                      |
| `limit`  | `20`             | Results per page (max 100)                       |
| `sort`   | `last_analyzed_at` | `followers`, `total_stars`, `public_repos`, `activity_score`, `last_analyzed_at` |
| `order`  | `desc`           | `asc` or `desc`                                  |
| `search` | —                | Filter by username, display name, or location    |



### Get a Single Profile

```
GET /api/profiles/:username
```

Returns the full profile including top 10 repos and language breakdown.

```bash
curl http://localhost:3000/api/profiles/torvalds
```

---

### Delete a Profile

```
DELETE /api/profiles/:username
```

```bash
curl -X DELETE http://localhost:3000/api/profiles/torvalds
```

---

### Get Profile Repositories

```
GET /api/profiles/:username/repos
```

Returns the stored top 10 repositories (by stars) for the user.

---

### Get Profile Language Breakdown

```
GET /api/profiles/:username/languages
```

Returns programming language usage percentages across non-forked repos.


### Global Statistics

```
GET /api/stats
```

Aggregate stats across all stored profiles plus top-5 leaderboards.

---

### Audit Logs

```
GET /api/logs?limit=50
```

Returns recent analysis events (created, refreshed, fetched) with response times.

---

### Health Check

```
GET /health
```

---

## Stored Insights

### `github_profiles` table

| Column             | Description                              |
|--------------------|------------------------------------------|
| `github_id`        | GitHub's numeric user ID                 |
| `username`         | Login handle                             |
| `display_name`     | Full name                                |
| `bio`              | Profile bio                              |
| `company`          | Listed company                           |
| `location`         | Location string                          |
| `email`            | Public email                             |
| `blog_url`         | Website / blog                           |
| `twitter_handle`   | Twitter username                         |
| `public_repos`     | Number of public repos                   |
| `public_gists`     | Number of public gists                   |
| `followers`        | Follower count                           |
| `following`        | Following count                          |
| `total_stars`      | Aggregate stars across non-forked repos  |
| `total_forks`      | Aggregate forks across non-forked repos  |
| `total_watchers`   | Aggregate watchers                       |
| `account_age_days` | Days since GitHub account creation       |
| `activity_score`   | Computed engagement score (weighted)     |
| `hireable`         | Whether user marked themselves hireable  |
| `last_analyzed_at` | Timestamp of most recent analysis        |

### `profile_repositories` table

Top 10 repos by stars - name, language, stars, forks, watchers, open issues.

### `profile_languages` table

Language - repo count + percentage breakdown (non-forked repos only).

### `analysis_log` table

Every API call is logged: action type, IP, response time, status.

---

## Activity Score Formula

```
score = log1p(followers) x 3 + log1p(total_stars) x 4 + log1p(public_repos) x 2
```

Uses `log1p` to prevent domination by outliers while still meaningfully ranking users.

---

## Rate Limits

| Endpoint            | Limit               |
|---------------------|---------------------|
| All `/api/*`        | 100 req / 15 min    |
| `POST /api/analyze` | 10 req / 1 min      |

Responses are cached in memory for 5 minutes (configurable via `CACHE_TTL`).





