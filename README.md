# SecureKit Monorepo

## Test Komutlari ve Kapsam

### 1) Tum testleri calistir

```bash
pnpm test
```

Bu komut root `package.json` icindeki scripti calistirir ve su iki paketin testlerini birlikte kosar:

- `@securekit/node-auth`
- `@securekit/web-sdk`

### 2) Sadece node-auth testleri

```bash
pnpm --filter @securekit/node-auth test -- --reporter=verbose
```

Calisan dosyalar:

- `packages/node-auth/src/__tests__/verify.network.test.ts`
- `packages/node-auth/src/__tests__/verify.location.test.ts`

Test edilenler:

- `POST /verify/network` endpointinin `NetworkResult` donmesi
- Skor/flag/reason mantigi (clean fixture ve risky fixture senaryolari)
- `POST /verify/vpn:check` alias endpointinin legacy response semasini korumasi
- `POST /verify/location` endpointinde `allowedCountries` kontrolu
- `POST /verify/location:country` alias endpointinin legacy semayi korumasi
- `runIpCheck` hata atarsa standart hata cevabi (`502` + `error.code`)

Not:

- Testler dis aga cikmaz.
- Gercek `python` spawn edilmez.
- `runIpCheck` mocklandigi icin testler deterministiktir.

### 3) Sadece web-sdk testleri

```bash
pnpm --filter @securekit/web-sdk test -- --reporter=verbose
```

Calisan dosya:

- `packages/web-sdk/src/__tests__/client.verify.test.ts`

Test edilenler:

- `verifyNetwork` methodunun `/verify/network` path'ine dogru body ile POST atmasi
- `verifyLocation` methodunun `/verify/location` path'ine dogru body ile POST atmasi
- Legacy methodlarin (`verifyVpn`, `verifyLocationCountry`) yeni methodlara yonlendirmesi

Not:

- `fetch` mocklandigi icin ag baglantisi kullanilmaz.
- Sonuclar fixture/mock ile deterministiktir.
