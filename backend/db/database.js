const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '../data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, 'taskflow.db');

let SQL, sqlDb;

function saveToDisk() {
  if (!sqlDb) return;
  try {
    const data = sqlDb.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch(e) { console.error('DB save error:', e); }
}

function rowsToObjects(result) {
  if (!result || result.length === 0) return [];
  const { columns, values } = result[0];
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

const db = {
  prepare(sql) {
    return {
      get(...params) {
        try {
          const stmt = sqlDb.prepare(sql);
          stmt.bind(params);
          if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
          }
          stmt.free();
          return null;
        } catch(e) { console.error('DB get error:', sql, e.message); throw e; }
      },
      all(...params) {
        try {
          const result = sqlDb.exec(sql, params);
          return rowsToObjects(result);
        } catch(e) { console.error('DB all error:', sql, e.message); throw e; }
      },
      run(...params) {
        try {
          sqlDb.run(sql, params);
          const lastId = sqlDb.exec('SELECT last_insert_rowid() as id');
          const changes = sqlDb.exec('SELECT changes() as n');
          const lastInsertRowid = lastId[0]?.values[0][0] || 0;
          const changesCount = changes[0]?.values[0][0] || 0;
          setTimeout(saveToDisk, 100);
          return { lastInsertRowid, changes: changesCount };
        } catch(e) { console.error('DB run error:', sql, e.message); throw e; }
      }
    };
  },
  exec(sql) {
    sqlDb.run(sql);
    setTimeout(saveToDisk, 100);
  }
};

async function initDB() {
  SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    sqlDb = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    sqlDb = new SQL.Database();
  }

  sqlDb.run('PRAGMA foreign_keys = ON');

  sqlDb.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  sqlDb.run(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'active',
    owner_id INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  )`);
  sqlDb.run(`CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'member', joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id),
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  sqlDb.run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'todo',
    priority TEXT DEFAULT 'medium', project_id INTEGER NOT NULL,
    assignee_id INTEGER, created_by INTEGER NOT NULL,
    due_date DATE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (assignee_id) REFERENCES users(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`);
  sqlDb.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    content TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  saveToDisk();
  setInterval(saveToDisk, 30000);
  process.on('exit', saveToDisk);
  process.on('SIGTERM', () => { saveToDisk(); process.exit(0); });
  process.on('SIGINT', () => { saveToDisk(); process.exit(0); });

  console.log('✅ Database initialized');
}

module.exports = { initDB, db };