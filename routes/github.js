const express = require("express");
const router = express.Router();

const {
  analyzeProfile,
  getAllProfiles,
  getProfile,
  deleteProfile,
  getProfileRepos,
  getProfileLanguages,
  getGlobalStats,
  getLogs,
} = require("../controllers/githubController");

const { analyzeLimiter, cacheMiddleware } = require("../middleware/rateLimiter");

//  Cache key factories 
const profileListKey = (req) =>
  `profiles:list:${req.query.page}:${req.query.limit}:${req.query.sort}:${req.query.order}:${req.query.search || ""}`;
const profileKey   = (req) => `profiles:${req.params.username}`;
const reposKey     = (req) => `repos:${req.params.username}`;
const langsKey     = (req) => `langs:${req.params.username}`;
const statsKey     = ()    => "global:stats";

//  Analyze / Refresh 

/**
 * @route  POST /api/analyze/:username
 * @desc   Fetch and store a GitHub user's insights
 * @access Public
 */
router.post("/analyze/:username", analyzeLimiter, analyzeProfile);

//  Profile CRUD 

/**
 * @route  GET /api/profiles
 * @desc   List all stored profiles
 * @query  page, limit, sort, order, search
 * @access Public
 */
router.get("/profiles", cacheMiddleware(profileListKey), getAllProfiles);

/**
 * @route  GET /api/profiles/:username
 * @desc   Get a single stored profile with repos and language breakdown
 * @access Public
 */
router.get("/profiles/:username", cacheMiddleware(profileKey), getProfile);

/**
 * @route  DELETE /api/profiles/:username
 * @desc   Delete a stored profile
 * @access Public
 */
router.delete("/profiles/:username", deleteProfile);

//  Sub-resources 

/**
 * @route  GET /api/profiles/:username/repos
 * @desc   Get stored repositories for a profile
 * @access Public
 */
router.get("/profiles/:username/repos", cacheMiddleware(reposKey), getProfileRepos);

/**
 * @route  GET /api/profiles/:username/languages
 * @desc   Get language breakdown for a profile
 * @access Public
 */
router.get("/profiles/:username/languages", cacheMiddleware(langsKey), getProfileLanguages);

//  Aggregate & Utility 

/**
 * @route  GET /api/stats
 * @desc   Global statistics across all stored profiles
 * @access Public
 */
router.get("/stats", cacheMiddleware(statsKey), getGlobalStats);

/**
 * @route  GET /api/logs
 * @desc   Recent analysis audit logs
 * @query  limit (default 50, max 200)
 * @access Public
 */
router.get("/logs", getLogs);

module.exports = router;
