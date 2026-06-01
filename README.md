# MQL Routing Dashboard

Single-page dashboard for Marketing & Sales: MQL cohort matched to Chili Piper Concierge routing logs.

## Live site

After GitHub Pages deploys, open:

`https://yoavpintel-bit.github.io/hibob-mql-routing-dashboard/`

(Replace org/user and repo name if you used a different repository name.)

## Update data

From the parent Chili Piper project:

```bash
npm run build:mql-drilldown
cp ../data/mql_drilldown_report.json public/data/mql_drilldown/report.json
cp ../data/mql_drilldown_report.csv public/data/mql_drilldown/report.csv
git add public/data/mql_drilldown/
git commit -m "Refresh MQL drilldown data"
git push
```

## Local preview

```bash
npx serve public -l 3000
# http://localhost:3000/
```
