import express from 'express';
import Database from 'better-sqlite3';
import https from 'https';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

const db = new Database('gtm_jobs.db');

function ingestData(): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ_v9LHrPAHvJpVrEfh83WH7V5gPTBBvuzWuMFmeJmp0XRP3w5LkFd2RlX7WbXL5ftgKs_1rwclngti/pub?gid=2036805849&single=true&output=csv';
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const lines = data.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
        db.exec(`
          CREATE TABLE IF NOT EXISTS job_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            week TEXT, company TEXT, job_title TEXT, location TEXT,
            score INTEGER, action TEXT, reason TEXT,
            employees INTEGER, funding REAL, job_url TEXT, posted_on TEXT
          )
        `);
        db.exec('DELETE FROM job_history');
        const insert = db.prepare(`
          INSERT INTO job_history (week, company, job_title, location, score, action, reason, employees, funding, job_url, posted_on)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertMany = db.transaction((rows: any[]) => {
          for (const row of rows) {
            insert.run(
              row['Week'] || '',
              row['Company'] || '',
              row['Job Title'] || '',
              row['Location'] || '',
              row['Score'] ? parseInt(row['Score']) : null,
              row['Action'] || '',
              row['Reason'] || '',
              row['Employees'] ? parseInt(row['Employees']) : null,
              row['Funding'] ? parseFloat(row['Funding']) : null,
              row['Job URL'] || '',
              row['Posted On'] || ''
            );
          }
        });
        const rows = lines.slice(1).map(line => {
          const values = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g) || [];
          const row: any = {};
          headers.forEach((h, i) => {
            row[h] = (values[i] || '').replace(/"/g, '').trim();
          });
          return row;
        });
        insertMany(rows);
        console.log(`Ingested ${rows.length} records`);
        resolve();
      });
    }).on('error', reject);
  });
}

app.post('/query', (req, res) => {
  const { sql } = req.body;
  if (!sql) return res.status(400).json({ error: 'No query provided' });
  try {
    const stmt = db.prepare(sql);
    const rows = stmt.all() as Record<string, unknown>[];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    res.json({ columns, rows, count: rows.length });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/schema', (req, res) => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
  const schema: any = {};
  tables.forEach((t: any) => {
    const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
    schema[t.name] = cols;
  });
  res.json(schema);
});

ingestData().then(() => {
  app.listen(PORT, () => {
    console.log(`GTM Analytics running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Ingest failed:', err);
  process.exit(1);
});
