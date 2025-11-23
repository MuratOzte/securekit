import { useEffect, useState } from "react";
import { SecureKitClient, type VerificationResult } from "@securekit/web-sdk";

// State tipleri
type HealthState = { ok: boolean; error?: string } | null;
type VpnResultState = (VerificationResult & { error?: string }) | null;

const client = new SecureKitClient({ baseUrl: 'http://localhost:3001' });

function App() {
    const [health, setHealth] = useState<HealthState>(null);
    const [vpnResult, setVpnResult] = useState<VpnResultState>(null);
    const [loading, setLoading] = useState<boolean>(false);

    useEffect(() => {
        client
            .health()
            .then(setHealth)
            .catch((err: unknown) => {
                const message =
                    err instanceof Error ? err.message : String(err);
                console.error(err);
                setHealth({ ok: false, error: message });
            });
    }, []);

    const handleVpnCheck = async () => {
        setLoading(true);
        try {
            const res = await client.verifyVpn();
            setVpnResult(res);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(err);
            setVpnResult({ ok: false, score: 0, error: message });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ padding: 24, fontFamily: 'system-ui' }}>
            <h1>SecureKit Demo</h1>

            <section>
                <h2>Health</h2>
                <pre>{JSON.stringify(health, null, 2)}</pre>
            </section>

            <section>
                <h2>VPN Check</h2>
                <button onClick={handleVpnCheck} disabled={loading}>
                    {loading ? 'Checking...' : 'Run VPN Check'}
                </button>
                <pre>{JSON.stringify(vpnResult, null, 2)}</pre>
            </section>
        </div>
    );
}

export default App;
