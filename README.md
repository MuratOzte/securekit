# SecureKit Monorepo

## Packages
- `@securekit/core`: shared contracts + risk + keystroke metrics/scoring
- `@securekit/node-auth`: Express API
- `@securekit/web-sdk`: browser/client SDK helpers
- `apps/demo-web`: SecureKit Playground UI

## Test Commands
Run all tests:

```bash
pnpm test
```

Run only node-auth:

```bash
pnpm --filter @securekit/node-auth test
```

Run only web-sdk:

```bash
pnpm --filter @securekit/web-sdk test
```

## Keystroke Dynamics (Real Typing)
Deterministic mock keystroke events were removed from Playground.

Current flow:
1. `POST /consent`
2. Enrollment rounds with real `keydown`/`keyup` capture -> `POST /enroll/keystroke`
3. Verification round with real typing -> `POST /verify/keystroke`
4. Optional session coupling -> `POST /verify/session` with `signals.keystroke`

### Challenge
- Playground fetches challenge text from `POST /challenge/text`.
- EN/TR and short/medium/long options are supported.
- Round completes when user types the challenge text exactly.

### Collector rules
- Capture happens only on the challenge input element.
- Timing source is `performance.now()`.
- Modifiers are ignored.
- `event.repeat` is ignored.
- IME composition is flagged and exposed in sample metadata.

## API Summary

### Consent
- `POST /consent`
- Request: `{ "userId": "u1", "consentVersion": "v1" }`

### Enrollment
- `POST /enroll/keystroke`
- Backward compatible legacy payload still works (`events`).
- Recommended payload:

```json
{
  "userId": "u1",
  "challengeId": "challenge-id",
  "sample": {
    "events": [{ "code": "KeyA", "type": "down", "t": 12.4, "expectedIndex": 0 }],
    "expectedText": "sample text",
    "typedLength": 11,
    "errorCount": 1,
    "backspaceCount": 1,
    "ignoredEventCount": 0,
    "imeCompositionUsed": false,
    "source": "collector_v1"
  }
}
```

Enrollment response now includes:
- `sampleMetrics`
- `enrollmentProgress`
- `reasons`

### Keystroke Verification
- `POST /verify/keystroke`
- Request supports policy thresholds:

```json
{
  "userId": "u1",
  "sample": { "events": [] },
  "policy": {
    "enabled": true,
    "allowThreshold": 0.76,
    "stepUpThreshold": 0.56,
    "denyThreshold": 0.36,
    "minEnrollmentRounds": 8,
    "minEnrollmentKeystrokes": 120,
    "minDigraphCount": 40,
    "updateProfileOnAllow": true,
    "profileUpdateAlpha": 0.08
  }
}
```

Response includes:
- `similarityScore` (`0..1`)
- `decision` (`allow | step_up | deny`)
- `distance`
- `reasons`
- `sampleMetrics`

### Session Integration
- `POST /verify/session`
- Optional request fields:
  - `userId`
  - `policy.keystroke`
  - `signals.keystroke`
- Response may include `signalsUsed.keystroke`.

## Keystroke Profile Fields
Backward compatible core fields remain:
- `holdMeanMs`, `holdStdMs`, `flightMeanMs`, `flightStdMs`, `sampleCount`

Additional fields:
- `sampleRoundCount`, `digraphCount`
- `ddMeanMs/std`, `udMeanMs/std`, `uuMeanMs/std`
- `typingSpeedMean`, `errorRateMean`, `backspaceRateMean`

## Config (node-auth)
Environment variables:
- `KEYSTROKE_ENROLL_MIN_ROUNDS` (default: `10`)
- `KEYSTROKE_ENROLL_MIN_KEYSTROKES` (default: `160`)
- `SESSION_TTL_SECONDS`
- `CHALLENGE_TTL_SECONDS`

## Playground Usage
File:
- `apps/demo-web/src/components/SecureKitPlayground.tsx`

Main controls:
- Step 1 consent
- Step 2 enrollment challenge rounds
- Step 3 verification challenge
- Profile read + biometric delete
- Optional `/verify/session` keystroke signal when `sessionId` is set
- Optional raw event debug view (dev only)

## Browser Timing Limitations
- `performance.now()` is high-resolution but still affected by device load.
- Background tabs, CPU throttling, battery saver, and accessibility tools can shift timing.
- Cross-device comparisons should use relaxed thresholds and enough enrollment rounds.
- IME composition can alter key timing patterns; composition use is flagged in sample metadata.
