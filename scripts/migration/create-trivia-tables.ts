import "dotenv/config";
import mysql from "mysql2/promise";

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const stmts = [
  `CREATE TABLE IF NOT EXISTS \`trivia_games\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`code\` varchar(8) NOT NULL,
    \`hostUserId\` int NOT NULL,
    \`hostName\` varchar(120),
    \`status\` enum('lobby','question_open','question_closed','question_revealed','finished') NOT NULL DEFAULT 'lobby',
    \`currentCat\` int,
    \`currentQ\` int,
    \`doneJson\` text,
    \`questionOpenedAt\` timestamp(3),
    \`createdAt\` timestamp NOT NULL DEFAULT (now()),
    \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT \`trivia_games_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`trivia_players\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`gameId\` int NOT NULL,
    \`userId\` int NOT NULL,
    \`displayName\` varchar(120) NOT NULL,
    \`joinedAt\` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT \`trivia_players_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`trivia_answers\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`gameId\` int NOT NULL,
    \`catIdx\` int NOT NULL,
    \`qIdx\` int NOT NULL,
    \`userId\` int NOT NULL,
    \`displayName\` varchar(120) NOT NULL,
    \`answerText\` text NOT NULL,
    \`isCorrect\` int NOT NULL DEFAULT 0,
    \`pointsAwarded\` int NOT NULL DEFAULT 0,
    \`submittedAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT \`trivia_answers_id\` PRIMARY KEY(\`id\`)
  )`,
];

for (const s of stmts) {
  await conn.query(s);
  console.log("ok:", s.match(/`(\w+)`/)[1]);
}
const [rows] = await conn.query("SHOW TABLES LIKE 'trivia%'");
console.log("trivia tables now:", rows);
await conn.end();
