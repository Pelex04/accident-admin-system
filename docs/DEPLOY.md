# Deploying and securing the admin system

## 1. Database (do this first)

The API stores everything in a database. Without `DATABASE_URL` it falls back to a local SQLite file, which
**hosting platforms such as Render erase on every redeploy**. For a real deployment use PostgreSQL.

1. Create a PostgreSQL database (Render PostgreSQL, Neon and Supabase all work) and copy its connection string.
2. On the API service, set `DATABASE_URL` to that string.
3. Redeploy. The tables are created automatically on start.

Data from before the database existed (`server/data/db.json`) is imported once, automatically, if the file is still
present when the API first starts against an empty database. If it is not (a fresh host), export what you need from the
dashboard (every table has an Export CSV button) and re-import it with the Import CSV buttons.

Local development needs no setup: leave `DATABASE_URL` empty and data goes to `server/data/app.db`.

## 2. Environment variables

| Variable | What it does |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. Required for production. |
| `JWT_SECRET` | Long random text that signs login tokens. If empty, a random one is generated and kept in the database. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | The first super admin, created only when the database has no admins. |
| `ALLOWED_ORIGINS` | Optional, comma separated dashboard addresses allowed to call the API. Empty allows any. |
| `JWT_EXPIRES_IN` | How long a sign in lasts. Default `12h`. |
| `PGSSL` | Set to `disable` only if your PostgreSQL does not use TLS. |

## 3. First sign in

The first super admin uses `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`. If the password is still the published default,
the dashboard makes you choose a new one before anything else. Any account found using the default password is treated
the same way at startup.

## 4. Roles

| Role | Can do |
| --- | --- |
| `viewer` | Read everything except admins and the audit log. |
| `admin` | Also create, edit and delete vehicles, contacts, crash events and SIM status. |
| `super_admin` | Also manage admins and read the audit log. |

Roles are checked against the database on every request, so deactivating an account, changing a role or resetting a
password takes effect immediately and ends that person's current sessions.

## 5. Sign in protection

- 30 sign in attempts per 15 minutes per address, and 8 per 15 minutes per email. Failures return the same message
  whether or not the email exists.
- New passwords need at least 10 characters with letters and a number.
- The API trusts one proxy hop for the client address, which matches Render and most similar hosts.

## 6. Tests

`npm test` in `server/` runs the API tests against SQLite. To run them against PostgreSQL, give each test file its own
empty database:

```
DATABASE_URL=postgresql://user:pass@localhost/test_api    node --test test/api.test.js
DATABASE_URL=postgresql://user:pass@localhost/test_legacy node --test test/legacy.test.js
```
