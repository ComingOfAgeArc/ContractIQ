# Deploying ContractIQ

Recommended: **one Render web service** that builds the React app and serves it from Express. One URL, no CORS, no second host. MongoDB stays on Atlas.

```
Browser ──► Render (Express: /api/* + built React app) ──► MongoDB Atlas
                                  └──────────────────────► Gemini API
```

## 1. MongoDB Atlas

1. Use the cluster you already have (M0 free is fine: this app needs 2 of its 3 search indexes).
2. **Network Access** → Add IP Address → `0.0.0.0/0`. Render's free tier has no fixed outbound IP, so Atlas must accept any IP; the database password is what protects it. Use a strong, generated password for the database user.
3. Make sure the indexes exist: run `npm run create:index` locally against the same `MONGODB_URI`, or check Atlas → your cluster → **Search & Vector Search**: `chunk_vector_index` and `chunk_text_index` are both READY.

## 2. Push to GitHub

```bash
cd contractiq
git init && git add . && git commit -m "ContractIQ"
# create an empty repo on GitHub, then:
git remote add origin https://github.com/<you>/contractiq.git
git push -u origin main
```

Check that `.env` is **not** in the commit (`.gitignore` excludes it).

## 3. Render

1. render.com → **New → Blueprint** → connect the repo. Render reads `render.yaml`.
2. When asked, paste the secrets: `MONGODB_URI` and `GEMINI_API_KEY`.
3. Deploy. The build runs `npm ci` + `vite build` for the client, then installs the server. The start command is `npm start --prefix server`.
4. Open `https://<your-service>.onrender.com/api/health` and check it shows `{"status":"ok"}`. Then open the root URL.

Free-tier notes:
- The service **sleeps after ~15 minutes idle**; the first request afterwards takes ~30–60 seconds. Mention this in your portfolio or open the site a minute before a demo.
- 512 MB RAM is enough for normal use. Uploaded PDFs are held in memory only during the upload request (20 MB max per file, 10 files max), and at most `PROCESSING_CONCURRENCY` (default 2) contracts are processed in the background at once.
- Background processing runs inside the web service. If Render restarts or redeploys the service while a contract is processing, that contract is marked "interrupted" on startup and shows a **Retry** button.

## Alternative: frontend on Vercel, API on Render

If you want the UI on Vercel:

1. Render: deploy as above, but set `CLIENT_URL=https://<your-app>.vercel.app` (comma-separate several origins).
2. Vercel: New Project → root directory `client` → framework Vite → env var `VITE_API_URL=https://<your-service>.onrender.com/api`.
3. `client/vercel.json` already rewrites all paths to `index.html`, so React Router links like `/contracts/:id` work on refresh.

## After deploying

- Upload the five `samples/` PDFs and wait for each to reach "Processing completed" (analysis runs automatically unless `AUTO_ANALYZE=off`), so visitors see a working demo.
- Run `npm run eval` locally against the production database and put the summary table in your README.
- Keep an eye on the Gemini quota in Google AI Studio. The rate limits in `middleware/rateLimit.js` cap how fast one visitor can use it.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Build fails on `npm ci` | `package-lock.json` missing: run `npm install` in `client/` and `server/` locally and commit the lock files |
| `MongoServerSelectionError` in logs | Atlas Network Access doesn't allow `0.0.0.0/0`, or wrong password in `MONGODB_URI` |
| Search/Ask return nothing | Indexes missing or not READY in Atlas, or contracts not `embedded` |
| `AI service error: API key not valid` | `GEMINI_API_KEY` not set in Render → Environment |
| 404 on page refresh (Vercel setup) | `vercel.json` missing from the `client` root |
| CORS error (Vercel setup) | `CLIENT_URL` on Render doesn't exactly match the Vercel origin (no trailing slash) |
