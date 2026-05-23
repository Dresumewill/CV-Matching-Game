# CV Matching Game

A real-time classroom game where trainees guess which personal statement belongs to which classmate — revealing how personal (or generic) their CV writing really is.

## How it works

1. A **volunteer** creates a game and shares the code + password with the class
2. Each **trainee** joins, pastes their personal statement, then votes on who wrote each statement
3. At the end, results show which statements were distinctive enough to identify

## Running locally

```bash
npm install
npm start
```

Open **http://localhost:3000** in your browser.

> **Note:** this app requires its own Node.js server (for real-time multiplayer via Socket.io). It will not work if you just open the HTML file directly or use VS Code Live Server alone — you must visit the `localhost:3000` URL while the server is running.

### Development (auto-restart on save)

```bash
npm install
npm run dev   # requires nodemon, installed as a dev dependency
```

### Tests

```bash
npm test
```

---

## Deploying

### Why not Vercel?

Vercel runs **serverless functions** — short-lived, stateless processes that shut down between requests. This app uses Socket.io for real-time communication, which requires a **persistent server** that can hold WebSocket connections and keep game state in memory. Vercel cannot do this.

Use **Render** or **Railway** instead.

---

### Deploy to Render (recommended, free tier available)

1. Push this repository to GitHub
2. Go to [render.com](https://render.com) and sign up / log in
3. Click **New → Web Service**
4. Connect your GitHub repo
5. Render will auto-detect the `render.yaml` config — just click **Deploy**

Render sets the `PORT` environment variable automatically; the app reads it already.

Your app will be live at `https://cv-matching-game.onrender.com` (or similar).

> **Free tier note:** Render's free tier spins the service down after 15 minutes of inactivity. The first request after that takes ~30 seconds to wake up. For paid use in class, upgrade to the Starter plan ($7/month) to avoid cold starts.

---

### Deploy to Railway

1. Push this repository to GitHub
2. Go to [railway.app](https://railway.app) and sign up / log in
3. Click **New Project → Deploy from GitHub repo**
4. Select the repo — Railway auto-detects Node.js from `package.json`
5. Click **Deploy**

Railway sets `PORT` automatically. No extra config needed.

---

### Deploy with Docker (any platform)

A `Dockerfile` is included. Build and run:

```bash
docker build -t cv-matching-game .
docker run -p 3000:3000 cv-matching-game
```

---

## Project structure

```
├── server.js          # Express + Socket.io server
├── gameManager.js     # Game state logic (no I/O, fully testable)
├── public/
│   ├── index.html     # Single-page frontend
│   ├── style.css      # Styles
│   ├── app.js         # Frontend JavaScript
│   └── socket.io.min.js  # Bundled Socket.io client
├── tests/
│   └── gameManager.test.js
├── Dockerfile
└── render.yaml
```

## Maintenance notes

- **No database.** All game state is in memory. Games delete themselves 24 hours after creation, or 30 minutes after finishing.
- **Restarting the server** ends any games currently in progress. For a classroom session, don't restart mid-game.
- **Scaling.** The app runs as a single process. If you ever run multiple instances, games won't be shared between them. For now, one instance is fine for classroom use.
