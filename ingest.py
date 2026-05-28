import requests
import sqlite3
import csv
import io
from tabulate import tabulate
from datetime import datetime

# Fetch Job History data from published Google Sheet
url = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ_v9LHrPAHvJpVrEfh83WH7V5gPTBBvuzWuMFmeJmp0XRP3w5LkFd2RlX7WbXL5ftgKs_1rwclngti/pub?gid=2036805849&single=true&output=csv"

print("Fetching Job History from Google Sheets...")
response = requests.get(url)
response.encoding = 'utf-8'

reader = csv.DictReader(io.StringIO(response.text))
rows = list(reader)
print(f"Found {len(rows)} historical job records")

# Connect to SQLite database
conn = sqlite3.connect("gtm_jobs.db")
cursor = conn.cursor()

# Create the job history table
cursor.execute("""
    CREATE TABLE IF NOT EXISTS job_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week TEXT,
        company TEXT,
        job_title TEXT,
        location TEXT,
        score INTEGER,
        action TEXT,
        reason TEXT,
        employees INTEGER,
        funding REAL,
        job_url TEXT,
        posted_on TEXT
    )
""")

# Clear and reload fresh data
cursor.execute("DELETE FROM job_history")

for row in rows:
    cursor.execute("""
        INSERT INTO job_history (week, company, job_title, location, score, action, reason, employees, funding, job_url, posted_on)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        row.get('Week', ''),
        row.get('Company', ''),
        row.get('Job Title', ''),
        row.get('Location', ''),
        row.get('Score') or None,
        row.get('Action', ''),
        row.get('Reason', ''),
        row.get('Employees') or None,
        row.get('Funding') or None,
        row.get('Job URL', ''),
        row.get('Posted On', '')
    ))

conn.commit()
print(f"Loaded {len(rows)} records into SQLite database\n")

print("--- PIPELINE ANALYTICS ---")

# Query 1: Jobs by tier
cursor.execute("SELECT score, COUNT(*) as count FROM job_history WHERE score IS NOT NULL GROUP BY score ORDER BY score")
tier_data = cursor.fetchall()
print("\nJobs by Tier:")
print(tabulate(tier_data, headers=["Tier", "Count"], tablefmt="rounded_outline"))

# Query 2: Apply Now jobs
cursor.execute("SELECT company, job_title, location, funding FROM job_history WHERE score = 1 ORDER BY funding DESC")
apply_now = cursor.fetchall()
print("\nApply Now (Tier 1):")
print(tabulate(apply_now, headers=["Company", "Title", "Location", "Funding"], tablefmt="rounded_outline"))

# Query 3: Average funding by tier
cursor.execute("SELECT score, ROUND(AVG(CAST(funding AS REAL)), 0) as avg_funding FROM job_history WHERE funding IS NOT NULL AND score IS NOT NULL GROUP BY score ORDER BY score")
avg_funding = cursor.fetchall()
print("\nAverage Funding by Tier:")
print(tabulate(avg_funding, headers=["Tier", "Avg Funding ($)"], tablefmt="rounded_outline"))

# Query 4: Top locations
cursor.execute("SELECT location, COUNT(*) as count FROM job_history GROUP BY location ORDER BY count DESC LIMIT 5")
locations = cursor.fetchall()
print("\nTop Locations:")
print(tabulate(locations, headers=["Location", "Count"], tablefmt="rounded_outline"))

# Query 5: Jobs per week
cursor.execute("SELECT week, COUNT(*) as count FROM job_history GROUP BY week ORDER BY week DESC")
weekly = cursor.fetchall()
print("\nJobs Surfaced Per Week:")
print(tabulate(weekly, headers=["Week", "Jobs"], tablefmt="rounded_outline"))

conn.close()
print("\nDatabase saved to gtm_jobs.db")

