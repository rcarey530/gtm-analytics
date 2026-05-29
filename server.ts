import express from 'express';
import https from 'https';
import http from 'http';
import initSqlJs from 'sql.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

let db: any;

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location!).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseCSV(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const data = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    if (ch === '"') {
      if (inQuotes && data[i+1] === '"') { cell += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' && !inQuotes) {
      row.push(cell.trim());
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some(v => v !== '')) rows.push(row); }
  return rows;
}

function ingestData(): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ_v9LHrPAHvJpVrEfh83WH7V5gPTBBvuzWuMFmeJmp0XRP3w5LkFd2RlX7WbXL5ftgKs_1rwclngti/pub?gid=2036805849&single=true&output=csv';
    fetchUrl(url).then(async (data) => {
      const SQL = await initSqlJs();
      db = new SQL.Database();
      db.run('CREATE TABLE IF NOT EXISTS job_history (id INTEGER PRIMARY KEY AUTOINCREMENT, week TEXT, company TEXT, job_title TEXT, location TEXT, score INTEGER, action TEXT, reason TEXT, employees INTEGER, funding REAL, job_url TEXT, posted_on TEXT)');
      const rows = parseCSV(data);
      const headers = rows[0];
      let count = 0;
      rows.slice(1).forEach(values => {
        const row: any = {};
        headers.forEach((h: string, i: number) => { row[h] = values[i] || ''; });
        db.run('INSERT INTO job_history (week, company, job_title, location, score, action, reason, employees, funding, job_url, posted_on) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
          row['Week']||'', row['Company']||'', row['Job Title']||'', row['Location']||'',
          row['Score']?parseInt(row['Score']):null, row['Action']||'', row['Reason']||'',
          row['Employees']?parseInt(row['Employees']):null, row['Funding']?parseFloat(row['Funding']):null,
          row['Job URL']||'', row['Posted On']||''
        ]);
        count++;
      });
      console.log('Ingested ' + count + ' records, first header: ' + headers[0] + ', first row company: ' + (rows[1] ? rows[1][1] : 'none'));
      resolve();
    }).catch(reject);
  });
}

app.post('/query', (req: any, res: any) => {
  const { sql } = req.body;
  if (!sql) return res.status(400).json({ error: 'No query provided' });
  try {
    const results = db.exec(sql);
    if (results.length === 0) return res.json({ columns: [], rows: [], count: 0 });
    const columns = results[0].columns;
    const rows = results[0].values.map((row: any[]) => {
      const obj: any = {};
      columns.forEach((col: string, i: number) => { obj[col] = row[i]; });
      return obj;
    });
    res.json({ columns, rows, count: rows.length });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/schema', (req: any, res: any) => {
  try {
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const schema: any = {};
    if (tables.length === 0) return res.json(schema);
    tables[0].values.forEach((row: any[]) => {
      const name = row[0];
      const cols = db.exec('PRAGMA table_info(' + name + ')');
      schema[name] = cols.length > 0 ? cols[0].values.map((c: any[]) => ({ name: c[1], type: c[2] })) : [];
    });
    res.json(schema);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

ingestData().then(() => {
  app.listen(PORT, () => { console.log('GTM Analytics running at http://localhost:' + PORT); });
}).catch(err => { console.error('Ingest failed:', err); process.exit(1); });
