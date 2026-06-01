# Deploy to GitHub (one-time)

## 1. Create the repository

Open: [Create `hibob-mql-routing-dashboard` on GitHub](https://github.com/new?name=hibob-mql-routing-dashboard&description=MQL+cohort+Chili+Piper+routing+dashboard&visibility=public)

- **Do not** add a README, .gitignore, or license (this folder already has them).

## 2. Push from your machine

```bash
cd "/Users/yoav.pintel/Documents/Cursor/Chili piper/mql-dashboard-web"
git remote add origin https://github.com/yoavpintel-bit/hibob-mql-routing-dashboard.git
git push -u origin main
```

If `origin` already exists:

```bash
git push -u origin main
```

**Or** with GitHub CLI:

```bash
gh repo create hibob-mql-routing-dashboard --public --source=. --remote=origin --push
```

## 3. Enable GitHub Pages

1. Repo → **Settings** → **Pages**
2. **Build and deployment** → Source: **GitHub Actions**
3. After the workflow runs (~1 min), open:

   **https://yoavpintel-bit.github.io/hibob-mql-routing-dashboard/**

## 4. Refresh data later

From the Chili Piper project root:

```bash
bash scripts/push-mql-dashboard-site.sh
cd mql-dashboard-web && git push
```
