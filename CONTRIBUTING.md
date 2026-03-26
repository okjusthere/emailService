# Contributing

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000/admin`.

## Before Sending A PR

Run the local verification steps:

```bash
npm run check
npm test
```

## Notes

- Mount `data/` to persistent storage in production.
- Use `npm run backup` before risky data migrations or manual maintenance.
- Keep README and `.env.example` in sync with runtime behavior when changing env vars or operational flows.
