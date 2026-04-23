# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

No test runner is configured.

## Architecture

Next.js 16 App Router project (TypeScript + React 19 + Tailwind CSS 4) with two features:
- **Todo list** — fully in-memory, no database, managed via `/api/todos`
- **Time tracking / Gantt chart** — persisted to MongoDB, managed via `/api/persons` and `/api/time-entries`

### Data flow

```
app/page.tsx
  └── app/components/TodoApp.tsx       ← todo feature (in-memory)
  └── app/components/GanttChart.tsx    ← time tracking feature
        └── app/components/TimeEntryModal.tsx

app/api/todos/route.ts                 ← in-memory store (module-level array)
app/api/persons/route.ts               ← MongoDB CRUD
app/api/persons/[id]/route.ts          ← cascade-deletes time entries on person delete
app/api/time-entries/route.ts          ← MongoDB CRUD, supports ?date= filter
app/api/time-entries/[id]/route.ts     ← PUT / DELETE

lib/mongodb.ts                         ← cached Mongoose connection
lib/models/Person.ts                   ← { name, timestamps }
lib/models/TimeEntry.ts                ← { personId, title, startHour, endHour, color, date }
lib/seed.ts                            ← one-off seed script
```

### Key details

- MongoDB connection string is hardcoded in `lib/mongodb.ts` (remote host `82.157.107.78`).
- Both Mongoose models serialize `_id → id` via `toJSON` transform.
- Path alias `@/*` maps to the repo root (`tsconfig.json`).
- Next.js 16 has breaking changes — read `node_modules/next/dist/docs/` before writing Next.js-specific code.
