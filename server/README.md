# Daily Expense — Server

Simple Express + SQLite backend for auth, budget and expenses.

Install & run:

```bash
cd server
npm install
node index.js
```

Server runs on port 4000 by default. Use `JWT_SECRET` env var to override token secret.

API endpoints:
- `POST /api/register` { username, password }
- `POST /api/login` { username, password }
- `GET /api/profile` (auth)
- `POST /api/budget` { budget } (auth)
- `GET /api/expenses` (auth)
- `POST /api/expenses` { description, amount, date } (auth)
- `DELETE /api/expenses/:id` (auth)
