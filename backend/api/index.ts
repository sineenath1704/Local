// Vercel serverless entrypoint.
// Vercel's builder recognizes an Express serverless function by seeing
// `express` used directly in THIS file. We create an express instance here
// and mount the fully-configured app from createApp() onto it.
import express from "express";
import { createApp } from "../src/app";

const app = express();
app.use(createApp());

export default app;
