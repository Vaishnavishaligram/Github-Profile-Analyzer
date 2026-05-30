const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "defaultdb",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
  ssl: {
    rejectUnauthorized: false
  }
});

async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log("✅  MySQL connected successfully");
    conn.release();
  } catch (err) {
    console.error("❌  MySQL connection failed:", err.message);
    process.exit(1);
  }
}

module.exports = { pool, testConnection };
