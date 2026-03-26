const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS certs (
    cert_number TEXT PRIMARY KEY,
    grade TEXT,
    subject TEXT,
    year TEXT,
    brand TEXT,
    card_number TEXT,
    category TEXT,
    variety TEXT,
    shopify_product_id TEXT,
    front_image_url TEXT,
    back_image_url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

function isAlreadyFetched(certNumber) {
  const row = db.prepare('SELECT cert_number FROM certs WHERE cert_number = ?').get(certNumber);
  return !!row;
}

function saveCert(cert) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO certs (cert_number, grade, subject, year, brand, card_number, category, variety, shopify_product_id, front_image_url, back_image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    cert.certNumber,
    cert.grade,
    cert.subject,
    cert.year,
    cert.brand,
    cert.cardNumber,
    cert.category,
    cert.variety,
    cert.shopifyProductId || null,
    cert.frontImageUrl || null,
    cert.backImageUrl || null
  );
}

function getCert(certNumber) {
  return db.prepare('SELECT * FROM certs WHERE cert_number = ?').get(certNumber);
}

function getAllCerts() {
  return db.prepare('SELECT * FROM certs ORDER BY created_at DESC').all();
}

module.exports = { isAlreadyFetched, saveCert, getCert, getAllCerts };
