
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

// Use Railway's persistent volume when deployed.
// Keep the original database location when running locally.
const dataFolder =
  process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;

// Make sure the storage folder exists.
fs.mkdirSync(dataFolder, { recursive: true });

// Database file location
const dbPath = path.join(dataFolder, "prime-shopping-hub.db");

const db = new DatabaseSync(dbPath);

// Create the tables if they do not already exist.
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    category TEXT,
    image TEXT,
    stock INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    total REAL NOT NULL,
    payment_status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
  );
`);

console.log("Database location:", dbPath);

module.exports = db;
