import express, { type Request, type Response } from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req: Request, res: Response) => res.json({ ok: true }));

app.post("/verify/webauthn:passkey", (req: Request, res: Response) => {
  const { proof } = (req.body ?? {}) as { proof?: unknown };
  const ok = !!proof;
  res.json({ ok, score: ok ? 1 : 0 });
});

app.post("/verify/face:liveness", (req: Request, res: Response) => {
  const { proof, metrics } = (req.body ?? {}) as {
    proof?: { tasksOk?: boolean };
    metrics?: { quality?: number };
  };
  const ok = proof?.tasksOk === true && (metrics?.quality ?? 0) > 0.8;
  res.json({ ok, score: ok ? 1 : 0 });
});

app.post("/verify/vpn:check", (_req: Request, res: Response) => {
  res.json({ ok: true, score: 0.9 });
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`node-auth listening on http://localhost:${PORT}`);
});
