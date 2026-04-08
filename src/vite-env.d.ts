/// <reference types="vite/client" />

/**
 * CIP-30 Cardano dApp wallet connector types
 */

interface Cip30WalletApi {
  getBalance(): Promise<string>;
  getChangeAddress(): Promise<string>;
  getCollateral(): Promise<string[] | null>;
  getNetworkId(): Promise<number>;
  getRewardAddresses(): Promise<string[]>;
  getUnusedAddresses(): Promise<string[]>;
  getUsedAddresses(): Promise<string[]>;
  getUtxos(): Promise<string[] | null>;
  signTx(tx: string, partialSign?: boolean): Promise<string>;
  signData(addr: string, payload: string): Promise<{ signature: string; key: string }>;
  submitTx(tx: string): Promise<string>;
  experimental: {
    getCollateral(): Promise<string[] | null>;
  };
  getExtensions(): Promise<unknown[]>;
}

interface Cip30Wallet {
  name: string;
  icon: string;
  apiVersion: string;
  enable(): Promise<Cip30WalletApi>;
  isEnabled(): Promise<boolean>;
}

declare global {
  interface Window {
    cardano?: {
      [walletName: string]: Cip30Wallet;
    };
  }
}

export {};