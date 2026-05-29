import express from 'express';
import sqlite3 from 'sqlite3';
import https from 'https';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

const db = new sqlite3.Database(':memory:');

function ingestData(): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ_v9LHrPAHvJpVrEfh83WH7V5gPTBBvuzWuMFmeJmp0XRP3w5LkFd2RlX7WbXL5ftgKs_1rwclngti/pub?gid=2036805849&single=true&output=csv';
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const lines = data.trim().split('\n');
        const headers = lines[0].split(',').map((h) => h.replace(/"/g, '').trim());
        db.serialize(() => {
          db.run('CREATE TABLE IF NOT EXISTS job_history (id INTEGER PRIMARY KEY AUTOINCREMENT, week TEXT, company TEXT, job_title TEXT, location TEXT, score INTEGER, action TEXT, reason TEXT, employees INTEGER, funding REAL, job_url TEXT, posted_on TEXT)');
          db.run('DELETE FROM job_history');
          const stmt = db.prepare('INSERT INTO job_history (week, company, job_title, location, score, action, reason, employees, funding, job_url, posted_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
          lines.slice(1).forEach(line => {
            const values = line.split(',').map((v) => v.replace(/"/g, '').trim());
            const row: any = {};
            headers.forEach((h, i) => { row[h] = values[i] || ''; });
            stmt.run(row['Week']||'', row['Company']||'', row['Job Title']||'', row['Location']||'', row['Score']?parseInt(row['Score']):null, row['Action']||'', row['Reason']||'', row['Employees']?parseInt(row['Employees']):null, row['Funding']?parseFloat(row['Funding']):null, row['Job URL']||'', row['Posted On']||'');
          });
          stmt.finalize(() => { console.log('Ingested ' + (lines.length-1) + ' records'); resolve(); });
        });
      });
    }).on('error', reject);
  });
}

app.post('/query', (req: any, res: any) => {
  const { sql } = req.body;
  if (!sql) return res.status(400).json({ error: 'No query provided' });
  db.all(sql, [], (err: any, rows: any[]) => {
    if (err) return res.status(400).json({ error: err.message });
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    res.json({ columns, rows, count: rows.length });
  });
});

app.get('/schema', (req: any, res: any) => {
  db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err: any, tables: any[]) => {
    if (err) return res.status(500).json({ error: err.message });
    const schema: any = {};
    let pending = tables.length;
    if (pending === 0) return res.json(schema);
    tables.forEach((t: any) => {
      db.all('PRAGMA table_info(' + t.name + ')', [], (err2: any, cols: any[]) => {
        schema[t.name] = cols;
        if (--pending === 0) res.json(schema);
      });
    });
  });
});

ingestData().then(() => {
  app.listen(PORT, () => { console.log('GTM Analytics running at http://localhost:' + PORT); });
}).catch(err => { console.error('Ingest failed:', err); process.exit(1); });
