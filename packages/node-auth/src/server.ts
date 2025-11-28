import express, { Request, Response } from 'express';
import cors from 'cors';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface VpnClientMetadata {
    clientTimeZone: string | null;
    clientTimeOffsetMinutes: number | null;
}

interface VpnCheckResultDetails extends VpnClientMetadata {
    ip: string | null;
    ipTimeZone: string | null;
    ipCountry: string | null;
    ipRegion: string | null;
    isVpn: boolean;
    isProxy: boolean;
    isTor: boolean;
    timezoneDriftHours: number | null;
    source: string | null;
}

interface VerificationResult {
    ok: boolean;
    score: number;
    details?: any;
}

interface LocationCountryResult extends VerificationResult {
    ipCountryCode: string | null;
    expectedCountryCode: string | null;
    clientCountryCode: string | null;
    details?: {
        ip: string | null;
        ipCountryCode: string | null;
        expectedCountryCode: string | null;
        clientCountryCode: string | null;
        reason: string | null;
        ipInfo?: unknown;
    };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Sağlık kontrolü
app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
});

// Passkey / WebAuthn stub
app.post('/verify/webauthn:passkey', (req: Request, res: Response) => {
    const { proof } = req.body ?? {};
    const ok = !!proof;

    const result: VerificationResult = {
        ok,
        score: ok ? 1 : 0,
    };

    res.json(result);
});

// Face liveness stub
app.post('/verify/face:liveness', (req: Request, res: Response) => {
    const { proof, metrics } = req.body ?? {};
    const ok = proof?.tasksOk === true && (metrics?.quality ?? 0) > 0.8;

    const result: VerificationResult = {
        ok,
        score: ok ? 1 : 0,
    };

    res.json(result);
});

// İstemci IP'sini çıkar
function getClientIp(req: Request): string | null {
    const xfwd = req.headers['x-forwarded-for'];

    let ip: string | null = null;

    if (typeof xfwd === 'string' && xfwd.length > 0) {
        ip = xfwd.split(',')[0]?.trim() || null;
    } else if (Array.isArray(xfwd) && xfwd.length > 0) {
        ip = xfwd[0];
    } else {
        ip = req.socket.remoteAddress ?? null;
    }

    console.log('[node-auth] RAW client IP:', ip);

    // GELİŞTİRME için override: localhost ise sabit gerçek bir IP kullan
    if (ip === '::1' || ip === '127.0.0.1') {
        ip = '8.8.8.8'; // sadece test için
        console.log('[node-auth] OVERRIDDEN IP for Python:', ip);
    }

    return ip;
}

// Body'den timezone metadata'sını oku (VPN için)
function parseVpnClientMetadata(req: Request): VpnClientMetadata {
    const body = req.body ?? {};
    const clientTimeZone =
        typeof body.clientTimeZone === 'string' ? body.clientTimeZone : null;
    const clientTimeOffsetMinutes =
        typeof body.clientTimeOffsetMinutes === 'number'
            ? body.clientTimeOffsetMinutes
            : null;

    return { clientTimeZone, clientTimeOffsetMinutes };
}

// Şimdilik fake VPN risk motoru (Python yok)
function fakeVpnRiskEngine(
    ip: string | null,
    meta: VpnClientMetadata
): VerificationResult {
    const ipTimeZone = 'Europe/Berlin';
    const ipCountry = 'DE';
    const ipRegion = 'Berlin';

    let timezoneDriftHours: number | null = null;
    if (meta.clientTimeZone) {
        timezoneDriftHours = meta.clientTimeZone === ipTimeZone ? 0 : 2;
    }

    let score = 1.0;

    const isVpn = false;
    const isProxy = false;
    const isTor = false;

    if (timezoneDriftHours !== null) {
        const drift = Math.abs(timezoneDriftHours);
        if (drift > 3) {
            score -= 0.6;
        } else if (drift > 1) {
            score -= 0.3;
        }
    }

    if (score < 0) score = 0;
    if (score > 1) score = 1;

    const ok = score >= 0.5;

    const details: VpnCheckResultDetails = {
        ip,
        ipTimeZone,
        ipCountry,
        ipRegion,
        isVpn,
        isProxy,
        isTor,
        timezoneDriftHours,
        clientTimeZone: meta.clientTimeZone,
        clientTimeOffsetMinutes: meta.clientTimeOffsetMinutes,
        source: 'fake-vpn-engine',
    };

    return { ok, score, details };
}

// VPN/proxy/Tor + timezone check endpoint
app.post('/verify/vpn:check', (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const meta = parseVpnClientMetadata(req);
    const result = fakeVpnRiskEngine(ip, meta);
    res.json(result);
});

// Ülke kodu normalize
function normalizeCountryCode(code: string | null): string | null {
    if (!code) return null;
    const trimmed = code.trim();
    if (!trimmed) return null;
    return trimmed.toUpperCase();
}

// ip_check.py'yi child_process üzerinden çalıştır
async function runIpCheckPython(
    ip: string,
    expectedCountryCode: string | null
): Promise<any> {
    const scriptPath = path.resolve(__dirname, '../../../python/ip_check.py');
    const args = [scriptPath, ip];
    if (expectedCountryCode) {
        args.push(expectedCountryCode);
    }

    return new Promise((resolve, reject) => {
        const proc = spawn('python', args, {
            cwd: path.dirname(scriptPath), // .env'in yükleneceği klasör
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        proc.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        proc.on('error', (err) => {
            reject(err);
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                console.error('[node-auth] ip_check.py stderr:', stderr);
                return reject(
                    new Error(`ip_check.py exited with code ${code}: ${stderr}`)
                );
            }
            try {
                const json = JSON.parse(stdout);
                console.log('[node-auth] ip_check.py result:', json);
                resolve(json);
            } catch (e) {
                console.error(
                    '[node-auth] Failed to parse ip_check.py stdout:',
                    stdout
                );
                reject(e);
            }
        });
    });
}

// Location Country check endpoint (Python entegrasyonlu)
app.post('/verify/location:country', async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const body = req.body ?? {};

    const expectedCountryCodeRaw =
        typeof body.expectedCountryCode === 'string'
            ? body.expectedCountryCode
            : null;

    const clientCountryCodeRaw =
        typeof body.clientCountryCode === 'string'
            ? body.clientCountryCode
            : null;

    const expectedCountryCode = normalizeCountryCode(expectedCountryCodeRaw);
    const clientCountryCode = normalizeCountryCode(clientCountryCodeRaw);

    if (!ip) {
        const result: LocationCountryResult = {
            ok: false,
            score: 0,
            ipCountryCode: null,
            expectedCountryCode,
            clientCountryCode,
            details: {
                ip: null,
                ipCountryCode: null,
                expectedCountryCode,
                clientCountryCode,
                reason: 'no_ip',
            },
        };
        res.status(400).json(result);
        return;
    }

    try {
        const pyResult = await runIpCheckPython(ip, expectedCountryCode);

        const ipCountryCode: string | null =
            (pyResult?.ip_country_code as string | null) ?? null;
        const sameCountry = pyResult?.same_country as boolean | null;

        let score = 0.7;
        let reason: string | null = 'no_expected_country';

        if (expectedCountryCode) {
            if (sameCountry === true) {
                score = 1.0;
                reason = 'match';
            } else if (sameCountry === false) {
                score = 0.2;
                reason = 'country_mismatch';
            }
        }

        if (score < 0) score = 0;
        if (score > 1) score = 1;

        const ok = score >= 0.5;

        const details: LocationCountryResult['details'] = {
            ip,
            ipCountryCode,
            expectedCountryCode,
            clientCountryCode,
            reason,
            ipInfo: pyResult?.ip_info ?? null,
        };

        const result: LocationCountryResult = {
            ok,
            score,
            ipCountryCode,
            expectedCountryCode,
            clientCountryCode,
            details,
        };

        res.json(result);
    } catch (err) {
        console.error('ip_check.py error:', err);

        const result: LocationCountryResult = {
            ok: false,
            score: 0,
            ipCountryCode: null,
            expectedCountryCode,
            clientCountryCode,
            details: {
                ip,
                ipCountryCode: null,
                expectedCountryCode,
                clientCountryCode,
                reason: 'ip_check_failed',
            },
        };

        res.status(500).json(result);
    }
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`node-auth listening on http://localhost:${PORT}`);
});
