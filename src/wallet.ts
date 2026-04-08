/**
 * wallet.ts — Cardano wallet integration for splitting NIGHT UTXOs
 *
 * Uses CIP-30 dApp connector + @emurgo/cardano-serialization-lib-browser
 * for direct transaction construction. No heavy SDK dependencies.
 *
 * NIGHT token (from on-chain CBOR):
 *   Policy ID:  d2dbff622e509dda256fedbd31ef6e9fd98ed49ad91d5c0e07f68af1
 *   Asset name: 4e49474854 (hex "NIGHT")
 */

import * as CSL from '@emurgo/cardano-serialization-lib-browser';
import type { Cip30WalletApi } from './vite-env';

// ─── Constants ──────────────────────────────────────────────────────────

const NIGHT_POLICY_ID = 'd2dbff622e509dda256fedbd31ef6e9fd98ed49ad91d5c0e07f68af1';
const NIGHT_ASSET_NAME_HEX = ''; // empty asset name
const NIGHT_UNIT = NIGHT_POLICY_ID;

// Min ADA to include with each native-token output (~1.5 ADA, safe margin)
const MIN_ADA_PER_OUTPUT = 2_000_000n; // 2 ADA in lovelace

// 6 decimal places: 5,000,000,000 raw = 5,000 NIGHT
const DECIMALS = 6;
const DECIMAL_FACTOR = 10n ** BigInt(DECIMALS);

// ─── Types ──────────────────────────────────────────────────────────────

export interface WalletInfo {
  id: string;
  api: Cip30WalletApi;
}

export interface SplitPreview {
  index: number;
  amount: bigint;
}

interface ParsedUtxo {
  txHash: string;
  txIndex: number;
  lovelace: bigint;
  nightAmount: bigint;
  cborHex: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatNight(raw: bigint): string {
  const whole = raw / DECIMAL_FACTOR;
  const frac = raw % DECIMAL_FACTOR;

  if (frac === 0n) {
    return whole.toLocaleString();
  }

  const fracStr = frac.toString().padStart(DECIMALS, '0').replace(/0+$/, '');
  return `${whole.toLocaleString()}.${fracStr}`;
}

// ─── UTXO Parsing ───────────────────────────────────────────────────────

function parseUtxos(cborHexArray: string[]): ParsedUtxo[] {
  return cborHexArray.map((hex) => {
    const utxo = CSL.TransactionUnspentOutput.from_bytes(hexToBytes(hex));
    const input = utxo.input();
    const output = utxo.output();
    const amount = output.amount();

    let nightAmount = 0n;
    const multiasset = amount.multiasset();
    if (multiasset) {
      const policyId = CSL.ScriptHash.from_bytes(hexToBytes(NIGHT_POLICY_ID));
      const assets = multiasset.get(policyId);
      if (assets) {
        // Only count the empty asset name token
        const emptyName = CSL.AssetName.new(new Uint8Array(0));
        const qty = assets.get(emptyName);
        if (qty) {
          nightAmount = BigInt(qty.to_str());
        }
      }
    }

    return {
      txHash: bytesToHex(input.transaction_id().to_bytes()),
      txIndex: input.index(),
      lovelace: BigInt(amount.coin().to_str()),
      nightAmount,
      cborHex: hex,
    };
  });
}

// ─── Wallet Discovery & Connection ──────────────────────────────────────

export function discoverWallets(): { id: string; name: string }[] {
  if (!window.cardano) return [];

  const wallets: { id: string; name: string }[] = [];
  for (const key of Object.keys(window.cardano)) {
    try {
      const entry = window.cardano[key];
      if (entry && typeof entry.enable === 'function') {
        wallets.push({ id: key, name: entry.name || key });
      }
    } catch {
      // skip
    }
  }
  return wallets;
}

export async function connectWallet(walletId: string): Promise<WalletInfo> {
  if (!window.cardano) {
    throw new Error('No Cardano wallet extension detected.');
  }

  const entry = window.cardano[walletId];
  if (!entry) throw new Error(`Wallet "${walletId}" not found.`);

  const api = await entry.enable();
  return { id: walletId, api };
}

// ─── Balance ────────────────────────────────────────────────────────────

export async function getNightBalance(api: Cip30WalletApi): Promise<bigint> {
  const utxoHexes = await api.getUtxos();
  if (!utxoHexes) return 0n;

  const utxos = parseUtxos(utxoHexes);
  return utxos.reduce((sum, u) => sum + u.nightAmount, 0n);
}

// ─── Split Logic ────────────────────────────────────────────────────────

export function calculateSplit(totalBalance: bigint, splitCount: number): SplitPreview[] {
  if (splitCount < 2) throw new Error('Split count must be at least 2.');
  if (totalBalance <= 0n) throw new Error('No NIGHT balance to split.');

  const count = BigInt(splitCount);
  const perOutput = totalBalance / count;
  const remainder = totalBalance % count;

  if (perOutput === 0n) {
    throw new Error(
      `Balance (${formatNight(totalBalance)} NIGHT) too small to split into ${splitCount} UTXOs.`,
    );
  }

  return Array.from({ length: splitCount }, (_, i) => ({
    index: i + 1,
    amount: i === splitCount - 1 ? perOutput + remainder : perOutput,
  }));
}

/**
 * Build and submit a Cardano transaction that splits NIGHT across N outputs.
 *
 * Strategy:
 *   1. Collect all UTXOs (both NIGHT-bearing and ADA-only)
 *   2. Add them all as inputs
 *   3. Create N outputs, each with split NIGHT + min ADA
 *   4. Change output gets remaining ADA (minus fee)
 *   5. Sign via CIP-30, submit
 */
export async function executeSplit(
  walletInfo: WalletInfo,
  splitCount: number,
  onLog: (msg: string) => void,
): Promise<string> {
  const { api } = walletInfo;

  // 1. Gather UTXOs and address
  onLog('Querying wallet...');
  const utxoHexes = await api.getUtxos();
  if (!utxoHexes || utxoHexes.length === 0) throw new Error('No UTXOs found.');

  const changeAddrHex = await api.getChangeAddress();
  const changeAddr = CSL.Address.from_bytes(hexToBytes(changeAddrHex));

  const allUtxos = parseUtxos(utxoHexes);
  const totalNight = allUtxos.reduce((s, u) => s + u.nightAmount, 0n);
  const totalLovelace = allUtxos.reduce((s, u) => s + u.lovelace, 0n);

  onLog(`NIGHT: ${formatNight(totalNight)} | ADA: ${formatNight(totalLovelace / 1_000_000n)}`);

  if (totalNight === 0n) throw new Error('No NIGHT tokens found.');

  // 2. Calculate split
  const splits = calculateSplit(totalNight, splitCount);
  const adaNeeded = MIN_ADA_PER_OUTPUT * BigInt(splitCount);

  if (totalLovelace < adaNeeded + 1_000_000n) {
    throw new Error(
      `Not enough ADA. Need ~${formatNight((adaNeeded + 1_000_000n) / 1_000_000n)} ADA for ${splitCount} outputs + fees. Have ${formatNight(totalLovelace / 1_000_000n)} ADA.`,
    );
  }

  onLog(`Building transaction with ${splitCount} outputs...`);

  // 3. Build transaction
  const txBuilder = CSL.TransactionBuilder.new(
    CSL.TransactionBuilderConfigBuilder.new()
      .fee_algo(CSL.LinearFee.new(
        CSL.BigNum.from_str('44'),
        CSL.BigNum.from_str('155381'),
      ))
      .pool_deposit(CSL.BigNum.from_str('500000000'))
      .key_deposit(CSL.BigNum.from_str('2000000'))
      .coins_per_utxo_byte(CSL.BigNum.from_str('4310'))
      .max_tx_size(16384)
      .max_value_size(5000)
      .build(),
  );

  // Add all UTXOs as inputs
  const txInputsBuilder = CSL.TxInputsBuilder.new();
  for (const utxo of allUtxos) {
    const txUnspent = CSL.TransactionUnspentOutput.from_bytes(hexToBytes(utxo.cborHex));
    txInputsBuilder.add_regular_input(
      txUnspent.output().address(),
      txUnspent.input(),
      txUnspent.output().amount(),
    );
  }
  txBuilder.set_inputs(txInputsBuilder);

  // Add N outputs with split NIGHT + min ADA each
  const policyId = CSL.ScriptHash.from_bytes(hexToBytes(NIGHT_POLICY_ID));
  const assetName = CSL.AssetName.new(new Uint8Array(0)); // empty asset name

  for (const split of splits) {
    const multiAsset = CSL.MultiAsset.new();
    const assets = CSL.Assets.new();
    assets.insert(assetName, CSL.BigNum.from_str(split.amount.toString()));
    multiAsset.insert(policyId, assets);

    const value = CSL.Value.new_with_assets(
      CSL.BigNum.from_str(MIN_ADA_PER_OUTPUT.toString()),
      multiAsset,
    );

    txBuilder.add_output(CSL.TransactionOutput.new(changeAddr, value));
  }

  // Add change output (remaining ADA)
  txBuilder.add_change_if_needed(changeAddr);

  onLog('Transaction built. Requesting signature...');

  // 4. Build, sign, submit
  const txBody = txBuilder.build();
  const tx = CSL.Transaction.new(
    txBody,
    CSL.TransactionWitnessSet.new(),
  );

  const txHex = bytesToHex(tx.to_bytes());
  const witnessSetHex = await api.signTx(txHex, true);

  // Merge witness
  const witnessSet = CSL.TransactionWitnessSet.from_bytes(hexToBytes(witnessSetHex));
  const signedTx = CSL.Transaction.new(txBody, witnessSet);
  const signedTxHex = bytesToHex(signedTx.to_bytes());

  onLog('Submitting transaction...');
  const txHash = await api.submitTx(signedTxHex);

  onLog(`Transaction submitted: ${txHash}`);
  return txHash;
}