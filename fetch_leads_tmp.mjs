
import mysql from 'mysql2/promise';
async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await conn.execute(`
    SELECT 
      id, name, category, address, phone, website, email,
      rating, reviewCount, qualificationScore, scoreTier,
      latitude, longitude, placeId, source, annotation,
      createdAt, updatedAt
    FROM saved_leads
    ORDER BY 
      CASE scoreTier WHEN 'hot' THEN 1 WHEN 'warm' THEN 2 WHEN 'cold' THEN 3 ELSE 4 END,
      qualificationScore DESC,
      category ASC,
      name ASC
  `);
  console.log(JSON.stringify(rows));
  await conn.end();
}
main().catch(e => { console.error(e); process.exit(1); });
