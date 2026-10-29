const { Sequelize } = require("sequelize");
const mysql = require("mysql2/promise");

const { DB_HOST = "localhost", DB_USER = "root", DB_PASSWORD = "", DB_NAME = "animal_db" } =
  process.env;

const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  dialect: "mysql",
  logging: false,
  define: {
    underscored: true,
    timestamps: true,
  },
});

/**
 * Create the database if it does not exist yet, so a fresh clone only needs
 * valid credentials — no manual SQL imports. Safe to run on every boot.
 */
async function ensureDatabase() {
  const connection = await mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
  });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME.replace(/`/g, "")}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    );
  } finally {
    await connection.end();
  }
}

module.exports = { sequelize, ensureDatabase };
