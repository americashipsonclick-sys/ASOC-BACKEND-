import express from "express";
import asoc from "../backend/src/index";

// Vercel Express only detects an app in src/index.ts, app.ts, or server.ts
// when this file itself imports `express` and constructs `express()`.
const app = express();
app.set("trust proxy", 1);
app.use(asoc);

export default app;
