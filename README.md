# DentalLead V2 — GPT-only polished MVP

## Run
1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Put your OpenAI API key in `.env`.
6. Run `npm start`.
7. Open http://localhost:3000

Never put an API key into the HTML or publish `.env`.

This is a demo, not a production medical system. Before selling it, add authentication, secure secret storage, persistent lead storage, consent/privacy controls, rate limiting, logging, human escalation and production hosting.

The clinic configuration is currently in `server.js`; later we can move it into a database so each dentist gets a separate configuration.
