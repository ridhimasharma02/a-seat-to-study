// Vercel runs this file as a serverless function for every /api/... request (see vercel.json).
// It reuses the same request handler as `npm start`.
export { handle as default } from '../server/server.js';
