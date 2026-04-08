import { useState, useCallback, useRef } from 'react';
import {
  discoverWallets,
  connectWallet,
  getNightBalance,
  calculateSplit,
  executeSplit,
  formatNight,
  type WalletInfo,
  type SplitPreview,
} from './wallet';
import './styles.css';

type Status = 'idle' | 'connecting' | 'connected' | 'fetching' | 'ready' | 'splitting' | 'success' | 'error';

interface LogEntry {
  time: string;
  msg: string;
}

export default function App() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [walletName, setWalletName] = useState('');
  const [balance, setBalance] = useState<bigint | null>(null);
  const [splitCount, setSplitCount] = useState(5);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const walletRef = useRef<WalletInfo | null>(null);

  const log = useCallback((msg: string) => {
    setLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(), msg }]);
  }, []);

  // ── Connect ─────────────────────────────────────────────────────────
  const handleConnect = useCallback(async () => {
    setStatus('connecting');
    setError(null);
    setLogs([]);
    log('Scanning for Cardano wallets...');

    try {
      const wallets = await discoverWallets();
      if (wallets.length === 0) {
        throw new Error('No Cardano wallets found. Make sure Lace is installed and set to a Cardano network.');
      }

      // Prefer lace, fall back to first available
      const selected = wallets.find((w) => w.id === 'lace') || wallets[0];
      log(`Found wallet: ${selected.name}. Connecting...`);

      const wallet = await connectWallet(selected.id);
      walletRef.current = wallet;
      setWalletName(selected.name);
      setStatus('connected');
      log('Connected.');
    } catch (err: any) {
      setError(err.message);
      setStatus('error');
      log(`Connection failed: ${err.message}`);
    }
  }, [log]);

  // ── Fetch Balance ───────────────────────────────────────────────────
  const handleFetchBalance = useCallback(async () => {
    if (!walletRef.current) return;
    setStatus('fetching');
    log('Fetching NIGHT balance...');

    try {
      const bal = await getNightBalance(walletRef.current.api);
      setBalance(bal);
      log(`NIGHT balance: ${formatNight(bal)}`);

      if (bal === 0n) {
        throw new Error('No NIGHT tokens found in wallet.');
      }
      setStatus('ready');
    } catch (err: any) {
      setError(err.message);
      setStatus('error');
      log(`Balance fetch failed: ${err.message}`);
    }
  }, [log]);

  // ── Execute Split ───────────────────────────────────────────────────
  const handleSplit = useCallback(async () => {
    if (!walletRef.current) return;
    setStatus('splitting');
    setError(null);
    setTxHash(null);

    try {
      const hash = await executeSplit(walletRef.current, splitCount, log);
      setTxHash(hash);
      setStatus('success');
    } catch (err: any) {
      setError(err.message);
      setStatus('error');
      log(`Split failed: ${err.message}`);
    }
  }, [splitCount, log]);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setWalletName('');
    setBalance(null);
    setTxHash(null);
    setLogs([]);
    walletRef.current = null;
  }, []);

  // ── Derived state ───────────────────────────────────────────────────
  let preview: SplitPreview[] = [];
  let balanceTooSmall = false;
  if (balance !== null && balance > 0n && splitCount >= 2) {
    try {
      preview = calculateSplit(balance, splitCount);
    } catch {
      balanceTooSmall = true;
    }
  }

  const pastConnect = ['connected', 'fetching', 'ready', 'splitting', 'success'].includes(status);
  const pastBalance = ['ready', 'splitting', 'success'].includes(status);

  return (
    <div className="container">
      {/* Header */}
      <header className="header">
        <div className="logo">N</div>
        <div>
          <h1 className="title">NIGHT Splitter</h1>
          <p className="subtitle">
            Split NIGHT tokens into multiple Cardano UTXOs via Lace
          </p>
        </div>
      </header>

      {/* Step 1: Connect */}
      <Section n="1" title="Connect Wallet" active={status === 'idle' || status === 'connecting'}>
        {status === 'idle' && (
          <Button onClick={handleConnect}>Connect to Lace</Button>
        )}
        {status === 'connecting' && (
          <div className="inline-status">
            <Spinner /> Connecting to Lace...
          </div>
        )}
        {pastConnect && <Pill>{walletName} connected</Pill>}
      </Section>

      {/* Step 2: Balance */}
      <Section n="2" title="Check Balance" active={status === 'connected' || status === 'fetching'}>
        {status === 'connected' && (
          <Button onClick={handleFetchBalance}>Fetch NIGHT Balance</Button>
        )}
        {status === 'fetching' && (
          <div className="inline-status">
            <Spinner /> Querying UTXOs...
          </div>
        )}
        {balance !== null && pastBalance && (
          <div className="balance-card">
            <div className="balance-label">NIGHT Balance</div>
            <div className="balance-value">
              {formatNight(balance)} <span className="balance-unit">NIGHT</span>
            </div>
          </div>
        )}
      </Section>

      {/* Step 3: Split */}
      <Section n="3" title="Split UTXOs" active={status === 'ready' || status === 'splitting'}>
        {(status === 'ready' || status === 'splitting') && (
          <>
            <label className="field-label">Number of UTXOs</label>
            <div className="count-row">
              {[2, 3, 5, 10, 20].map((n) => (
                <button
                  key={n}
                  className={`count-btn ${splitCount === n ? 'active' : ''}`}
                  onClick={() => setSplitCount(n)}
                  disabled={status === 'splitting'}
                >
                  {n}
                </button>
              ))}
              <input
                type="number"
                className="count-input"
                min={2}
                max={100}
                value={splitCount}
                onChange={(e) =>
                  setSplitCount(Math.max(2, Math.min(100, parseInt(e.target.value) || 2)))
                }
                disabled={status === 'splitting'}
              />
            </div>

            <div className="info-box">
              Each UTXO requires ~1.5 ADA minimum. Splitting into {splitCount} UTXOs
              needs ~{(splitCount * 1.5).toFixed(1)} ADA for min-UTXO deposits.
            </div>

            {preview.length > 0 && !balanceTooSmall && (
              <div className="preview">
                <div className="preview-label">Preview</div>
                {preview.map((s) => (
                  <div key={s.index} className="preview-row">
                    <span className="preview-idx">UTXO #{s.index}</span>
                    <span className="preview-amt">{formatNight(s.amount)} NIGHT</span>
                  </div>
                ))}
              </div>
            )}

            {balanceTooSmall && (
              <div className="error-box">
                Balance too small to split into {splitCount} UTXOs.
              </div>
            )}

            <Button
              onClick={handleSplit}
              disabled={status === 'splitting' || balanceTooSmall}
            >
              {status === 'splitting' ? (
                <><Spinner size={14} /> Splitting...</>
              ) : (
                `Split into ${splitCount} UTXOs`
              )}
            </Button>
          </>
        )}

        {status === 'success' && txHash && (
          <div className="success-card">
            <div className="success-title">Split successful</div>
            <div className="tx-label">Transaction Hash</div>
            <div className="tx-hash">
              <a
                href={`https://preview.cardanoscan.io/transaction/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="tx-link"
              >
                {txHash}
              </a>
            </div>
            <button className="link-btn" onClick={reset}>Split again</button>
          </div>
        )}
      </Section>

      {/* Error */}
      {status === 'error' && error && (
        <div className="error-card">
          <div className="error-title">Error</div>
          <div className="error-msg">{error}</div>
          <button className="link-btn error-link" onClick={reset}>Start over</button>
        </div>
      )}

      {/* Log */}
      {logs.length > 0 && (
        <div className="log-panel">
          <div className="log-label">Activity Log</div>
          <div className="log-scroll">
            {logs.map((l, i) => (
              <div key={i} className="log-line">
                <span className="log-time">{l.time}</span> {l.msg}
              </div>
            ))}
          </div>
        </div>
      )}

      <footer className="footer">
        Built for <a href="https://midnight.network" target="_blank" rel="noreferrer">Midnight Network</a> · NIGHT on Cardano
      </footer>
    </div>
  );
}

// ── Reusable bits ────────────────────────────────────────────────────────

function Section({ n, title, active, children }: {
  n: string; title: string; active: boolean; children: React.ReactNode;
}) {
  return (
    <div className={`section ${active ? 'section-active' : ''}`}>
      <div className="section-header">
        <div className={`section-num ${active ? 'section-num-active' : ''}`}>{n}</div>
        <div className={`section-title ${active ? '' : 'section-title-dim'}`}>{title}</div>
      </div>
      {children}
    </div>
  );
}

function Button({ onClick, disabled, children }: {
  onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button className="primary-btn" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <div className="pill">
      <div className="pill-dot" />
      {children}
    </div>
  );
}

function Spinner({ size = 16 }: { size?: number }) {
  return <div className="spinner" style={{ width: size, height: size }} />;
}