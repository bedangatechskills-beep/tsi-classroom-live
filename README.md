# TSI Classroom Live

> No question gets lost. Students don't need to be perfect.

A live Q&A and polling room for Tech Skills Institute classes. The instructor puts the presenter screen on the projector; students scan a QR code, type a nickname and ask questions — in whatever language or English they think in — without an account or an install.

## Problem

Many students don't ask questions out loud. Confusion stays hidden until the assignment, and when class ends nobody — student or instructor — has a clear picture of what was unclear.

## Who it's for

- **Instructor** — runs the class, projects the presenter screen, moderates, runs polls, carries unanswered questions into the next session.
- **Student** — on a phone, often on mobile data, wants to ask without being singled out.

## MVP scope

1. **Instructor sign-in with GitHub.**
2. **Rooms** — each room has a 6-letter code; the presenter screen shows the code and a QR code linking straight to the join page.
3. **Student join** — scan QR (or type the code), enter a nickname, you're in. No account, no install, works on mobile data.
4. **Anonymous questions** — shown without names, upvoted and sorted live. One vote per student per question.
5. **Polls** — the instructor creates a poll; students vote; result bars update live; the instructor closes it.
6. **Moderation** — the instructor can hide a question or mark it answered. Students cannot. The instructor console shows who asked (nickname); the projector never does.
7. **Recap** — when the room closes, unanswered questions are kept and the instructor can export them as a Markdown recap for the next class.

## Out of scope

- Leaderboards
- Student accounts
- Native app
- Staging environments
- Analytics dashboard

## Definition of done

- A student's question reaches the projector in **under 3 seconds, without a refresh**.
- The **real class uses it today**.
- Unanswered questions come out as a **Markdown recap** at the end.

## Stack (free tiers only)

| Layer | Choice |
|-------|--------|
| Frontend | React + Vite (SPA) |
| Database, auth, realtime | Supabase — Postgres, GitHub OAuth for the instructor, Realtime for live updates |
| Security | Row Level Security; students write only their own rows, only the room owner moderates |
| Hosting | Vercel (Hobby), production deploys from `main` |
| Repo | Public GitHub repo; this README is the PRD |

Look: TSI colours from techskills.institute: orange `#F05921`, blue `#005EA1` and navy `#102844`.

Hosting note: Vercel Hobby is for non-commercial use. It's fine for the class demo; for ongoing use at TSI, move to Cloudflare Pages (the free tier allows commercial use).

Students are not Supabase users. Each browser gets a random participant ID stored locally — this avoids per-IP auth rate limits when a whole class shares one venue network.

## Data model (planned)

`rooms` · `participants` · `questions` · `votes` (unique per question + participant) · `polls` · `poll_options` · `poll_votes`

## Routes (planned)

- `/` — instructor sign-in and room list
- `/r/:code` — student join and room view
- `/room/:code` — instructor console (moderation, nicknames, polls, close + recap)
- `/present/:code` — presenter screen for the projector (no nicknames)
