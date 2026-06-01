# Push checklist (2 minutes)

The site is committed locally in this folder. GitHub repo **does not exist yet** — create it once, then push.

## 1. Create empty repo on GitHub

Browser should open: [Create `hibob-mql-routing-dashboard`](https://github.com/new?name=hibob-mql-routing-dashboard&description=MQL+cohort+Chili+Piper+routing+dashboard&visibility=public)

- Owner: **yoavpintel-bit**
- Name: **hibob-mql-routing-dashboard**
- Public
- **Do not** add README, .gitignore, or license

Click **Create repository**.

## 2. Push from Terminal

```bash
cd "/Users/yoav.pintel/Documents/Cursor/Chili piper/mql-dashboard-web"
git push -u origin main
```

## 3. Enable GitHub Pages

Repo → **Settings** → **Pages** → Build: **GitHub Actions**

Wait ~1 minute for the workflow, then open:

**https://yoavpintel-bit.github.io/hibob-mql-routing-dashboard/**

## 4. Update data later

```bash
cd "/Users/yoav.pintel/Documents/Cursor/Chili piper"
bash scripts/push-mql-dashboard-site.sh
cd mql-dashboard-web && git add -A && git commit -m "Refresh MQL data" && git push
```
