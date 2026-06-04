import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
const c = await mysql.createConnection(process.env.DATABASE_URL);
await c.query(`CREATE TABLE IF NOT EXISTS uber_receipts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  orderId VARCHAR(128) NOT NULL,
  status VARCHAR(32),
  amount DECIMAL(10,2),
  currency VARCHAR(8),
  orderDate TIMESTAMP NULL,
  requesterName VARCHAR(255),
  requesterEmail VARCHAR(320),
  storeName VARCHAR(255),
  deliveryAddress TEXT,
  facilityId INT,
  facilityName VARCHAR(255),
  expenseId INT,
  expenseTable VARCHAR(32),
  raw JSON,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_order (orderId)
)`);
console.log("✅ uber_receipts table ready");
await c.end();
