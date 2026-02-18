# SecureKit Monorepo

## Test Komutlari ve Kapsam

### 1) Tum testleri calistir

```bash
pnpm test
```

Bu komut root `package.json` icindeki scripti calistirir ve su iki paketin testlerini birlikte kosar:

- `@securekit/node-auth`
- `@securekit/web-sdk`

Calisan test dosyalari (toplam):

- `packages/node-auth/src/__tests__/verify.network.test.ts`
- `packages/node-auth/src/__tests__/verify.location.test.ts`
- `packages/node-auth/src/__tests__/session.start.test.ts`
- `packages/node-auth/src/__tests__/verify.session.test.ts`
- `packages/web-sdk/src/__tests__/client.verify.test.ts`
- `packages/web-sdk/src/__tests__/client.session.test.ts`

### 2) Sadece node-auth testleri

```bash
pnpm --filter @securekit/node-auth test -- --reporter=verbose
```

Calisan dosyalar:

- `packages/node-auth/src/__tests__/verify.network.test.ts`
- `packages/node-auth/src/__tests__/verify.location.test.ts`
- `packages/node-auth/src/__tests__/session.start.test.ts`
- `packages/node-auth/src/__tests__/verify.session.test.ts`

#### 2.1) `verify.network` testleri (`verify.network.test.ts`)

Kapsam:

- `POST /verify/network` endpointinin `NetworkResult` donmesi.
- Clean fixture ve risky fixture uzerinden skor, flag ve reason alanlarinin dogrulanmasi.
- `POST /verify/vpn:check` alias endpointinin legacy response semasini korudugunun dogrulanmasi.
- `runIpCheck` hata atarsa standart hata cevabi (`502` + `error.code`) dondugunun dogrulanmasi.

Neden onemli:

- Aþama 1 davranisinin korunmasini garanti eder.
- Network sinyalinin session risk orkestrasyonuna girmeden once dogru uretildigini teyit eder.

#### 2.2) `verify.location` testleri (`verify.location.test.ts`)

Kapsam:

- `POST /verify/location` endpointinde `allowedCountries` policy kontrolu.
- `POST /verify/location:country` alias endpointinin legacy sema ve davranis uyumu.

Neden onemli:

- Ulke bazli policy uygulamasinin deterministik calistigini gosterir.
- Session asamasinda tekrar kullanilan location semantics'in tutarliligini korur.

#### 2.3) Session baslatma testi (`session.start.test.ts`)

Kapsam:

- `POST /session/start` icin `status=200` dondugunun kontrolu.
- `sessionId` degerinin UUID formatinda olmasi.
- `expiresAt` alaninin ISO formatinda olmasi ve `now + TTL` ile uyumlu olmasi.

Deterministik yontem:

- Store'a `nowFn` ve `ttlMs` enjekte edilerek test zamani sabitlenir.
- Boylece test farkli makinelerde ayni sonucu verir.

#### 2.4) Session risk orkestrasyon testleri (`verify.session.test.ts`)

Bu dosya Aþama 2'nin ana entegrasyon test kapsamini saglar:

- Unknown session:
- `POST /verify/session` icin `404` ve `error.code=SESSION_NOT_FOUND` beklenir.

- Happy allow:
- Clean fixture (`network score=95`, `location country=TR`) ile `decision=allow`, bos `requiredSteps`, dusuk `riskScore` beklenir.

- Step-up:
- Risky fixture (`vpn/tor/proxy/relay` + disallowed country) ile `decision=step-up` beklenir.
- `requiredSteps` icinde `keystroke` adimi ve UI metinleri (`Typing Check`, `Type the shown text naturally.`) assert edilir.
- `reasons` icinde `COUNTRY_NOT_ALLOWED` ve `VPN_DETECTED` gibi kodlar kontrol edilir.

- Deny:
- `treatVpnAsFailure=true` ve `vpn=true` oldugunda `decision=deny` ve `VPN_TREATED_AS_FAILURE` beklenir.

- Expired session:
- Kisa TTL + ileri zaman simulasyonu ile `410` ve `error.code=SESSION_EXPIRED` beklenir.

- Signal persistence:
- Ilk cagrida sadece `network`, ikinci cagrida sadece `location` gonderilerek session icinde merge/persist davranisi dogrulanir.
- Sonraki cagri response'unda `signalsUsed` altinda iki sinyalin birlikte geldigi kontrol edilir.

Neden onemli:

- Aþama 2 gereksinimlerini (sessionId, aggregate risk, decision, required steps) dogrudan dogrular.
- Policy etkilerinin (`allowedCountries`, `treatVpnAsFailure`, threshold'ler) beklenen karari uretdigini garanti eder.

Node-auth testleri icin genel notlar:

- Testler dis aga cikmaz.
- Gercek `python` spawn edilmez.
- `runIpCheck` mocklandigi icin dis bagimliliklardan etkilenmez.
- Session testlerinde zaman kontrolu store'a enjekte edilen `nowFn` ile yapilir.

### 3) Sadece web-sdk testleri

```bash
pnpm --filter @securekit/web-sdk test -- --reporter=verbose
```

Calisan dosyalar:

- `packages/web-sdk/src/__tests__/client.verify.test.ts`
- `packages/web-sdk/src/__tests__/client.session.test.ts`

#### 3.1) Verify client testleri (`client.verify.test.ts`)

Kapsam:

- `verifyNetwork` methodunun `/verify/network` endpointine dogru body ile POST atmasi.
- `verifyLocation` methodunun `/verify/location` endpointine dogru body ile POST atmasi.
- Legacy methodlarin (`verifyVpn`, `verifyLocationCountry`) yeni methodlara delegasyonunun dogrulanmasi.

#### 3.2) Session client testleri (`client.session.test.ts`)

Kapsam:

- `startSession()` metodunun `/session/start` endpointine POST atmasi ve cevabi oldugu gibi donmesi.
- `verifySession()` metodunun `/verify/session` endpointine dogru payload ile POST atmasi.
- `sessionId`, `policy`, `signals.network`, `signals.location` alanlarinin request body'de pass-through gittiginin dogrulanmasi.

Neden onemli:

- SDK'nin yeni session API kontratini bozmadigini garanti eder.
- Server-side policy merge yaklasimi korunurken client'in yalnizca dogru request olusturdugu teyit edilir.

Web-SDK testleri icin genel notlar:

- `fetch` mocklandigi icin ag baglantisi kullanilmaz.
- Sonuclar fixture/mock ile deterministiktir.

### 4) Hizli calistirma komutlari

Tum testler:

```bash
pnpm test
```

Sadece node-auth:

```bash
pnpm --filter @securekit/node-auth test
```

Sadece web-sdk:

```bash
pnpm --filter @securekit/web-sdk test
```

## Asama 3 challenge ekleri

Yeni test dosyalari:

- `packages/node-auth/src/__tests__/challenge.text.test.ts`
- `packages/web-sdk/src/__tests__/client.challenge.test.ts`

Challenge endpoint ornekleri:

```bash
curl -X POST http://localhost:3001/challenge/text \
  -H "Content-Type: application/json" \
  -d '{"lang":"tr","length":"short"}'
```

```bash
curl -X POST http://localhost:3001/challenge/text/consume \
  -H "Content-Type: application/json" \
  -d '{"challengeId":"YOUR_CHALLENGE_ID"}'
```
