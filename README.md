# NECROPOLIS — Discord Server Audit

A client-side tool for analyzing Discord server audit logs. Upload your audit log exports and get insights into server activity.

## Prerequisites

- **Node.js** 18+ (tested with Node 20+)
- **npm** 9+

## Getting Started

```bash
# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`).

## Build for Production

```bash
npm run build
```

Output goes to `dist/`. Serve it with any static file server or use the preview command:

```bash
npm run preview
```

## Scripts

| Command           | Description                              |
| ----------------- | ---------------------------------------- |
| `npm run dev`     | Start Vite dev server with HMR           |
| `npm run build`   | Type-check with `tsc` then build         |
| `npm run preview` | Preview the production build locally     |
