import express from 'express';
import https from 'https';
import http from 'http';
import initSqlJs from 'sql.js';
import cookieParser from 'cookie-parser';
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.query.key === 'rc530') {
    res.cookie('access', 'rc530', { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    return next();
  }
  if (req.cookies && req.cookies.access === 'rc530') return next();
  return res.status(404).send('Not found');
});
app.use(express.json());
app.use(express.static('public'));
let db: any;
function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GTMAnalytics/1.0)' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location!).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}
function ingestData(): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = 'https://raw.githubusercontent.com/rcarey530/rcarey530.github.io/main/job-history.json';
    fetchUrl(url).then(async (data) => {
      const SQL = await initSqlJs();
      db = new SQL.Database();
      db.run('CREATE TABLE IF NOT EXISTS job_history (id INTEGER PRIMARY KEY AUTOINCREMENT, week TEXT, company TEXT, job_title TEXT, location TEXT, score INTEGER, action TEXT, reason TEXT, employees INTEGER, funding REAL, job_url TEXT, posted_on TEXT)');
      const parsed = JSON.parse(data);
      const jobs = parsed.jobs || [];
      let count = 0;
      jobs.forEach((job: any) => {
        db.run('INSERT INTO job_history (week, company, job_title, location, score, action, reason, employees, funding, job_url, posted_on) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
          job.week||job['Week']||'',
          job.company||job['Company']||'',
          job.jobTitle||job['Job Title']||'',
          job.location||job['Location']||'',
          job.score||job['Score']||null,
          job.action||job['Action']||'',
          job.reason||job['Reason']||'',
          job.employees||job['Employees']||null,
          job.funding||job['Funding']||null,
          job.jobUrl||job['Job URL']||'',
          job.postedOn||job['Posted On']||''
        ]);
        count++;
      });
      console.log('Ingested ' + count + ' records from GitHub');
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
