# NIGHT Splitter

A browser app that connects to the Midnight Lace wallet extension and splits your unshielded NIGHT balance into multiple equal UTXOs via self-send.

## Project Structure

```
night-splitter/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .npmrc                  ← Midnight registry config (you create this)
├── src/
│   ├── main.tsx            ← Entry point
│   ├── App.tsx             ← UI component
│   ├── wallet.ts           ← All Midnight SDK + DApp Connector logic
│   ├── styles.css          ← Styles
│   └── vite-env.d.ts       ← TypeScript types for Lace extension
└── README.md
```

## Setup

### 1. Clone / create the project

Put all the files in the structure above.

### 2. Configure the Midnight npm registry

Create `.npmrc` in the project root:

```ini
@midnight-ntwrk:registry=https://npm.midnight.network/
//npm.midnight.network/:_authToken=YOUR_TOKEN_HERE
```

Get your auth token from the [Midnight developer portal](https://docs.midnight.network).

### 3. Install & run locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. You'll need the Midnight Lace browser extension installed and unlocked.

### 4. Build for production

```bash
npm run build
```

Output goes to `dist/`.

## Deploy to Vercel

### Option A: Git push (recommended)

1. Push this repo to GitHub / GitLab / Bitbucket
2. Go to [vercel.com/new](https://vercel.com/new) and import the repo
3. Vercel auto-detects Vite — no config needed
4. **Important:** Add your Midnight npm registry auth as a Vercel environment variable so the build can install `@midnight-ntwrk` packages. In Vercel project settings → Environment Variables, add:
   - `NPM_TOKEN` = your Midnight registry token
5. Update your `.npmrc` to reference the env var:
   ```ini
   @midnight-ntwrk:registry=https://npm.midnight.network/
   //npm.midnight.network/:_authToken=${NPM_TOKEN}
   ```
6. Deploy. Every push auto-deploys.

### Option B: Vercel CLI

```bash
npm i -g vercel
vercel
```

Follow the prompts. Vercel detects Vite automatically.

## How It Works

There's no native "split UTXO" operation in Midnight. The app constructs a single transaction with N outputs, all directed to your own address. The Lace wallet's balancer selects your existing UTXO(s) as inputs, and the network creates N new UTXOs as outputs.

The flow:

1. **Connect** — Discovers the Lace extension via `window.midnight`, calls `.connect()` which triggers the Lace approval popup
2. **Fetch balance** — Calls `getUnshieldedBalances()` via the DApp Connector API
3. **Split** — Builds an `UnshieldedOffer` with N outputs (each `balance / N`), wraps it in a `Transaction` blueprint, and submits it to Lace via `balanceAndProveTransaction()`. Lace handles input selection, ZK proving, signing, and submission.

Integer division remainder goes to the last UTXO (e.g., 100 ÷ 3 = 33 + 33 + 34).

## Caveats

- **Multi-output UnshieldedOffer** — The docs don't explicitly confirm multiple outputs are supported in a single offer. Test on testnet first. If it fails, the fallback is N separate single-output self-send transactions.
- **Fees** — The wallet balancer deducts fees from your inputs. If you're splitting your entire balance, there may not be enough left for fees.
- **Unshielded only** — This splits unshielded NIGHT. Shielded balance splitting would require a different transaction type.
- **Package versions** — The `@midnight-ntwrk` package versions in `package.json` use `^1.0.0` as placeholders. Pin to whatever versions are current on the Midnight registry.
- **DApp Connector API** — The exact method signatures (especially `balanceAndProveTransaction`) may differ from what's documented. Check the Lace extension's actual API surface if something doesn't resolve.

## Troubleshooting

**"No Midnight wallets found"** — Lace isn't installed, isn't unlocked, or the page loaded before the extension injected `window.midnight`. Try refreshing.

**Build fails on `@midnight-ntwrk` imports** — Your `.npmrc` token is wrong or missing. Verify you can `npm view @midnight-ntwrk/ledger-v8` from the command line.

**Transaction rejected** — Could be a multi-output issue (see caveats), insufficient balance for fees, or TTL expiry. Check the Lace wallet logs.
