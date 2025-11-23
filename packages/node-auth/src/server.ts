import express, { type Request, type Response } from "express";
import cors from "cors";
import { spawn } from "child_process";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Python script yolu: repo kökünden "python/ip_check.py"
// node-auth server'ı her zaman repo kökünden (securekit klasörü) çalıştırdığını varsayıyoruz.
const PYTHON_SCRIPT_PATH = path.resolve(process.cwd(), "python/ip_check.py");

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

// Python script'inden beklenen JSON tipi
interface IpCheckPythonResult {
  same_country: boolean | null;
  ip_country_code: string | null;
  expected_country_code: string | null;
  ip_info: unknown;
}

/**
 * Ülke tutarlılığı doğrulaması
 * Body: { expectedCountryCode: "TR" }
 */
app.post("/verify/location:country", (req: Request, res: Response) => {
  const { expectedCountryCode } = (req.body ?? {}) as {
    expectedCountryCode?: string;
  };

  if (!expectedCountryCode) {
    return res.status(400).json({
      ok: false,
      score: 0,
      error: "expectedCountryCode gerekli",
    });
  }

  // Client IP'yi al
  const xff = req.headers["x-forwarded-for"];
  const clientIp = Array.isArray(xff)
    ? xff[0].split(",")[0].trim()
    : xff
    ? xff.split(",")[0].trim()
    : req.socket.remoteAddress;

  if (!clientIp) {
    return res.status(400).json({
      ok: false,
      score: 0,
      error: "IP bulunamadı",
    });
  }

  const args = [clientIp, expectedCountryCode];

  const py = spawn("python", [PYTHON_SCRIPT_PATH, ...args]);

  let stdout = "";
  let stderr = "";

  py.stdout.on("data", (data: Buffer) => {
    stdout += data.toString();
  });

  py.stderr.on("data", (data: Buffer) => {
    stderr += data.toString();
  });

  py.on("close", (code: number | null) => {
    if (code !== 0) {
      return res.status(500).json({
        ok: false,
        score: 0,
        error: "Python script hata verdi",
        stderr,
        exitCode: code,
      });
    }

    try {
      const result = JSON.parse(stdout) as IpCheckPythonResult;
      const ok = result.same_country === true;
      const score = ok ? 1 : 0;

      return res.json({
        ok,
        score,
        ipCountryCode: result.ip_country_code,
        expectedCountryCode: result.expected_country_code,
        raw: result.ip_info, // istersen UI'da da kullanabilirsin
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        score: 0,
        error: "Python çıktısı JSON parse edilemedi",
        raw: stdout,
      });
    }
  });
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`node-auth listening on http://localhost:${PORT}`);
});
