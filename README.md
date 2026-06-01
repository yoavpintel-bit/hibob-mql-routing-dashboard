# MQL Routing Dashboard

Single-page dashboard for Marketing & Sales: MQL cohort matched to Chili Piper Concierge routing logs.

## Live site

After the GitHub Action runs successfully:

1. Repo → **Settings** → **Pages**
2. **Build and deployment** → Source: **Deploy from a branch**
3. Branch: **`gh-pages`** · Folder: **`/ (root)`** → **Save**
4. Open (after ~1 min):

   **https://yoavpintel-bit.github.io/hibob-mql-routing-dashboard/**

> **Note:** The first workflow run publishes files to the `gh-pages` branch. You only need step 1–3 once. If you prefer **GitHub Actions** as the Pages source instead, enable that under Settings → Pages, then switch the workflow back to `configure-pages` / `deploy-pages`.

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
