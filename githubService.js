const axios = require("axios");

const GITHUB_BASE = "https://api.github.com";

/** Shared Axios instance with GitHub auth headers */
const githubClient = axios.create({
  baseURL: GITHUB_BASE,
  timeout: 10_000,
  headers: {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(process.env.GITHUB_TOKEN && {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    }),
  },
});

/**
 * Fetch a user's public profile.
 * @param {string} username
 * @returns {Promise<object>} raw GitHub user object
 */
async function fetchUserProfile(username) {
  const { data } = await githubClient.get(`/users/${username}`);
  return data;
}

/**
 * Fetch ALL public repositories for a user (handles pagination).
 * @param {string} username
 * @returns {Promise<object[]>}
 */
async function fetchUserRepos(username) {
  const repos = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data } = await githubClient.get(`/users/${username}/repos`, {
      params: { per_page: perPage, page, sort: "updated", type: "owner" },
    });
    repos.push(...data);
    if (data.length < perPage) break;
    page++;
    if (page > 10) break; // safety cap — max 1 000 repos
  }

  return repos;
}

/**
 * Derive useful aggregate insights from the raw repos array.
 * @param {object[]} repos
 * @returns {{
 *   totalStars: number,
 *   totalForks: number,
 *   totalWatchers: number,
 *   topRepos: object[],
 *   languageMap: Record<string, number>,
 * }}
 */
function aggregateRepoInsights(repos) {
  let totalStars = 0;
  let totalForks = 0;
  let totalWatchers = 0;
  const languageMap = {};

  for (const repo of repos) {
    if (repo.fork) continue; // skip forks for aggregate stats

    totalStars += repo.stargazers_count || 0;
    totalForks += repo.forks_count || 0;
    totalWatchers += repo.watchers_count || 0;

    if (repo.language) {
      languageMap[repo.language] = (languageMap[repo.language] || 0) + 1;
    }
  }

  // Top 10 repos by stars
  const topRepos = [...repos]
    .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
    .slice(0, 10);

  return { totalStars, totalForks, totalWatchers, topRepos, languageMap };
}

/**
 * Compute a simple "activity score" based on followers, stars and repo count.
 * Score = log1p(followers)*3 + log1p(stars)*4 + log1p(repos)*2
 */
function computeActivityScore(followers, totalStars, repos) {
  const score =
    Math.log1p(followers) * 3 +
    Math.log1p(totalStars) * 4 +
    Math.log1p(repos) * 2;
  return Math.round(score * 100) / 100;
}

module.exports = {
  fetchUserProfile,
  fetchUserRepos,
  aggregateRepoInsights,
  computeActivityScore,
};
