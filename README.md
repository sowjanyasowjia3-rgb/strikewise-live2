# Strikewise Live

Educational F&O dashboard (Pulse, Sectors, Options & OI, Screeners, Strength, Radar, Journal, Academy).
No order placement. Zero dependencies, Node 18+.

## Run
    node server.js                       # demo provider (simulated, drifting data)
    PROVIDER=licensed DATA_API_KEY=... DATA_API_URL=... node server.js

Open http://localhost:3000. Env: PORT, REFRESH_SECONDS (default 30), PROVIDER.

## Go live with real data
1. Get a licence or API from an authorised vendor or your broker. Read its terms on display and redistribution.
2. Implement `getSnapshot()` in providers/licensed.js and return the JSON shape documented at the top of that file.
3. Set `mode` ('live' or 'delayed') and `delayMinutes` to match your licence. The page header shows them.
4. Deploy to any Node host (Render, Railway, Fly.io, a VPS). Keep API keys in environment variables, never in public/.

The server caches one upstream call per refresh interval, so visitor count does not increase vendor calls.
If the vendor fails, the last good data is served and flagged "Stale".

## Install on Android (no APK)
Host the server on HTTPS (Render, Railway, Fly.io). Open the link in Chrome, tap the three-dot menu, then
"Install app" or "Add to Home screen". The app opens full screen. Without internet it shows the last
loaded screens; live data needs a connection.

## Admin panel (/admin)
Set `ADMIN_PASSWORD` (a long, unique password) in your host's environment settings. Without it the admin is disabled;
there is no default password. Then open `/admin` on your site and sign in. You can see data status and errors, force a
refresh, switch provider, change the refresh interval and post a notice to visitors. Sessions last 8 hours; five wrong
passwords from one address lock sign-in for 15 minutes. Optional: set `SESSION_SECRET` so sessions survive restarts.
Use HTTPS (your host provides it) and never put the password in the code or in public/.
