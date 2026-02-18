import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type IpCheckSecurity = {
  vpn?: boolean | null;
  proxy?: boolean | null;
  tor?: boolean | null;
  relay?: boolean | null;
  hosting?: boolean | null;
  mobile?: boolean | null;
  suspicious?: boolean | null;
};

export type IpCheckLocation = {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  country_code?: string | null;
  time_zone?: string | null;
  utc_offset_minutes?: number | null;
};

export type IpCheckInfo = {
  ip?: string | null;
  security?: IpCheckSecurity | null;
  location?: IpCheckLocation | null;
  network?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type IpCheckOutput = {
  same_country?: boolean | null;
  ip_country_code?: string | null;
  expected_country_code?: string | null;
  ip_info?: IpCheckInfo | null;
  [key: string]: unknown;
};

export type RunIpCheckParams = {
  clientOffsetMin?: number | null;
  expectedCountryCode?: string | null;
};

export async function runIpCheck(
  ip: string,
  params: RunIpCheckParams = {}
): Promise<IpCheckOutput> {
  const projectRoot = path.resolve(__dirname, "../../../../");
  const scriptPath = path.join(projectRoot, "python", "ip_check.py");

  const args = [scriptPath, ip];
  if (params.expectedCountryCode) {
    args.push(params.expectedCountryCode);
  }

  const pythonCommand =
    process.env.PYTHON_CMD || (process.platform === "win32" ? "py" : "python3");

  return new Promise<IpCheckOutput>((resolve, reject) => {
    const proc = spawn(pythonCommand, args, {
      cwd: path.dirname(scriptPath),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      reject(error);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ip_check.py exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as IpCheckOutput;
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
  });
}
