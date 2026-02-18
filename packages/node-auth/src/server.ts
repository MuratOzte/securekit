import express, { Request, Response } from 'express';
import cors from 'cors';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface VpnClientMetadata {
    clientTimeZone: string | null;
    clientTimeOffsetMinutes: number | null;
}

interface VerificationResult {
  ok: boolean;
  score: number;
  details?: unknown;
}

interface VpnCheckResultDetails extends VpnClientMetadata {
    ip: string | null;
    ipTimeZone: string | null;
    ipCountry: string | null;
    ipRegion: string | null;
    isVpn: boolean;
    isProxy: boolean;
    isTor: boolean;
    isRelay: boolean;
    timezoneDriftHours: number | null;
    source: string | null;
    ipInfo?: unknown;
}

interface LocationCountryResultDetails {
    ip: string | null;
    ipCountryCode: string | null;
    expectedCountryCode: string | null;
    clientCountryCode: string | null;
    matchesExpectedCountry: boolean | null;
    matchesClientCountry: boolean | null;
    reason: string | null;
    ipInfo?: unknown;
    security: {
        vpn: boolean | null;
        proxy: boolean | null;
        tor: boolean | null;
        relay: boolean | null;
    };
}

interface LocationCountryResult extends VerificationResult {
    ipCountryCode: string | null;
    expectedCountryCode: string | null;
    clientCountryCode: string | null;
    details?: LocationCountryResultDetails;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// --------------------------------------------------
// Helpers
// --------------------------------------------------

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

    // Dev ortamı için localhost override
    if (process.env.NODE_ENV !== 'production') {
        if (ip === '::1' || ip === '127.0.0.1') {
            ip = '8.8.8.8'; // test için sabit IP
            console.log('[node-auth] OVERRIDDEN IP for Python:', ip);
        }
    }

    return ip;
}

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

function normalizeCountryCode(code: string | null): string | null {
    if (!code) return null;
    const trimmed = code.trim();
    if (!trimmed) return null;
    return trimmed.toUpperCase();
}

async function runIpCheckPython(
    ip: string,
    expectedCountryCode: string | null
): Promise<any> {
    const projectRoot = path.resolve(__dirname, '../../../');
    const scriptPath = path.join(projectRoot, 'python', 'ip_check.py');

    const args = [scriptPath, ip];
    if (expectedCountryCode) {
        args.push(expectedCountryCode);
    }

    const pythonCommand =
        process.env.PYTHON_CMD ||
        (process.platform === 'win32' ? 'py' : 'python3');

    console.log('[node-auth] Using python command:', pythonCommand, args);

    return new Promise((resolve, reject) => {
        const proc = spawn(pythonCommand, args, {
            cwd: path.dirname(scriptPath),
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

function computeTimezoneDriftHours(
    ipOffsetMinutes: number | null,
    clientOffsetMinutes: number | null
): number | null {
    if (
        typeof ipOffsetMinutes !== 'number' ||
        typeof clientOffsetMinutes !== 'number'
    ) {
        return null;
    }
    const diffMinutes = Math.abs(ipOffsetMinutes - clientOffsetMinutes);
    return diffMinutes / 60;
}

// --------------------------------------------------
// Health + other stubs
// --------------------------------------------------

app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
});

app.post('/verify/webauthn:passkey', (req: Request, res: Response) => {
    const { proof } = req.body ?? {};
    const ok = !!proof;

    const result: VerificationResult = {
        ok,
        score: ok ? 1 : 0,
    };

    res.json(result);
});

app.post('/verify/face:liveness', (req: Request, res: Response) => {
    const { proof, metrics } = req.body ?? {};
    const ok = proof?.tasksOk === true && (metrics?.quality ?? 0) > 0.8;

    const result: VerificationResult = {
        ok,
        score: ok ? 1 : 0,
    };

    res.json(result);
});

// --------------------------------------------------
// /verify/vpn:check  (VPN/proxy/Tor + timezone drift)
// --------------------------------------------------

app.post('/verify/vpn:check', async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const meta = parseVpnClientMetadata(req);

    if (!ip) {
        const result: VerificationResult & { details: VpnCheckResultDetails } =
            {
                ok: false,
                score: 0,
                details: {
                    ip: null,
                    ipTimeZone: null,
                    ipCountry: null,
                    ipRegion: null,
                    isVpn: false,
                    isProxy: false,
                    isTor: false,
                    isRelay: false,
                    timezoneDriftHours: null,
                    clientTimeZone: meta.clientTimeZone,
                    clientTimeOffsetMinutes: meta.clientTimeOffsetMinutes,
                    source: 'ip_missing',
                    ipInfo: null,
                },
            };
        res.status(400).json(result);
        return;
    }

    try {
        const pyResult = await runIpCheckPython(ip, null);
        const ipInfo = (pyResult?.ip_info ?? null) as any;

        const security = (ipInfo?.security ?? {}) as any;
        const location = (ipInfo?.location ?? {}) as any;

        const vpn = security?.vpn === true || security?.vpn === true;
        const proxy = security?.proxy === true || security?.proxy === true;
        const tor = security?.tor === true || security?.tor === true;
        const relay = security?.relay === true || security?.relay === true;

        const ipTimeZone: string | null =
            typeof location?.time_zone === 'string' ? location.time_zone : null;
        const ipCountry: string | null =
            typeof location?.country_code === 'string'
                ? location.country_code
                : null;
        const ipRegion: string | null =
            typeof location?.region === 'string'
                ? location.region
                : typeof location?.city === 'string'
                  ? location.city
                  : null;

        const ipOffsetMinutes: number | null =
            typeof location?.utc_offset_minutes === 'number'
                ? location.utc_offset_minutes
                : null;

        const timezoneDriftHours = computeTimezoneDriftHours(
            ipOffsetMinutes,
            meta.clientTimeOffsetMinutes
        );

        // Base score
        let score = 1.0;

        // Timezone drift penalty
        if (timezoneDriftHours !== null) {
            if (timezoneDriftHours > 6) {
                score -= 0.5;
            } else if (timezoneDriftHours > 3) {
                score -= 0.3;
            } else if (timezoneDriftHours > 1) {
                score -= 0.1;
            }
        }

        // Security penalties
        if (vpn) score -= 0.5;
        if (proxy) score -= 0.3;
        if (tor) score -= 0.7;
        if (relay) score -= 0.2;

        if (score < 0) score = 0;
        if (score > 1) score = 1;

        const ok = score >= 0.5;

        const details: VpnCheckResultDetails = {
            ip,
            ipTimeZone,
            ipCountry,
            ipRegion,
            isVpn: vpn,
            isProxy: proxy,
            isTor: tor,
            isRelay: relay,
            timezoneDriftHours,
            clientTimeZone: meta.clientTimeZone,
            clientTimeOffsetMinutes: meta.clientTimeOffsetMinutes,
            source: 'vpnapi.io+ip_check.py',
            ipInfo,
        };

        const result: VerificationResult & { details: VpnCheckResultDetails } =
            {
                ok,
                score,
                details,
            };

        res.json(result);
    } catch (err) {
        console.error('vpn:check ip_check.py error:', err);

        const details: VpnCheckResultDetails = {
            ip,
            ipTimeZone: null,
            ipCountry: null,
            ipRegion: null,
            isVpn: false,
            isProxy: false,
            isTor: false,
            isRelay: false,
            timezoneDriftHours: null,
            clientTimeZone: meta.clientTimeZone,
            clientTimeOffsetMinutes: meta.clientTimeOffsetMinutes,
            source: 'ip_check_failed',
            ipInfo: null,
        };

        const result: VerificationResult & { details: VpnCheckResultDetails } =
            {
                ok: false,
                score: 0,
                details,
            };

        res.status(500).json(result);
    }
});

// --------------------------------------------------
// /verify/location:country  (country + security)
// --------------------------------------------------

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
                matchesExpectedCountry: null,
                matchesClientCountry: null,
                reason: 'no_ip',
                ipInfo: null,
                security: {
                    vpn: null,
                    proxy: null,
                    tor: null,
                    relay: null,
                },
            },
        };
        res.status(400).json(result);
        return;
    }

    try {
        const pyExpected = expectedCountryCode ?? clientCountryCode ?? null;
        const pyResult = await runIpCheckPython(ip, pyExpected);

        const ipCountryCode: string | null =
            typeof pyResult?.ip_country_code === 'string'
                ? (pyResult.ip_country_code as string)
                : null;

        const ipInfo = (pyResult?.ip_info ?? null) as any;
        const security = (ipInfo?.security ?? {}) as any;

        const vpn = security?.vpn === true || security?.vpn === true;
        const proxy = security?.proxy === true || security?.proxy === true;
        const tor = security?.tor === true || security?.tor === true;
        const relay = security?.relay === true || security?.relay === true;

        const matchesExpectedCountry =
            expectedCountryCode && ipCountryCode
                ? ipCountryCode === expectedCountryCode
                : null;

        const matchesClientCountry =
            clientCountryCode && ipCountryCode
                ? ipCountryCode === clientCountryCode
                : null;

        let score = 0.7;
        let reason: string | null = 'no_expected_country';

        if (expectedCountryCode) {
            if (matchesExpectedCountry === true) {
                score = 1.0;
                reason = 'match_expected';
            } else if (matchesExpectedCountry === false) {
                score = 0.2;
                reason = 'expected_country_mismatch';
            }
        } else if (matchesClientCountry !== null) {
            if (matchesClientCountry === true) {
                score = 1.0;
                reason = 'match_client_country';
            } else {
                score = 0.2;
                reason = 'client_country_mismatch';
            }
        }

        // Security bazlı penalty
        let penalty = 0;
        if (vpn) penalty += 0.4;
        if (proxy) penalty += 0.3;
        if (tor) penalty += 0.5;
        if (relay) penalty += 0.2;

        const rawScore = score - penalty;
        score = Math.max(0, Math.min(1, rawScore));

        if (vpn || proxy || tor || relay) {
            if (
                reason === 'match_expected' ||
                reason === 'match_client_country'
            ) {
                reason = 'country_match_but_ip_security_risky';
            } else if (!reason || reason === 'no_expected_country') {
                reason = 'ip_security_risky';
            }
        }

        const ok = score >= 0.5;

        const details: LocationCountryResultDetails = {
            ip,
            ipCountryCode,
            expectedCountryCode,
            clientCountryCode,
            matchesExpectedCountry,
            matchesClientCountry,
            reason,
            ipInfo,
            security: {
                vpn,
                proxy,
                tor,
                relay,
            },
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
        console.error('location:country ip_check.py error:', err);

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
                matchesExpectedCountry: null,
                matchesClientCountry: null,
                reason: 'ip_check_failed',
                ipInfo: null,
                security: {
                    vpn: null,
                    proxy: null,
                    tor: null,
                    relay: null,
                },
            },
        };

        res.status(500).json(result);
    }
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
    console.log(`node-auth listening on http://localhost:${PORT}`);
});
