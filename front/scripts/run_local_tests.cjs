// Lightweight local tests for computeReporterBond logic (CommonJS)

function computeReporterBond(requestedAmountWei) {
  try {
    const amt = typeof requestedAmountWei === 'bigint' ? requestedAmountWei : BigInt(requestedAmountWei || 0);
    if (amt <= 0n) return 0n;
    let bond = (amt * 5n) / 1000n; // 0.5% = 5/1000
    if (bond === 0n) bond = 1n; // ensure non-zero bond for small amounts
    return bond;
  } catch (e) {
    return 0n;
  }
}

function assertEqual(a, b, msg) {
  if (a !== b) {
    console.error(`FAIL: ${msg} — expected ${String(b)}, got ${String(a)}`);
    process.exitCode = 2;
    return false;
  }
  console.log(`ok: ${msg}`);
  return true;
}

function run() {
  let ok = true;
  ok = assertEqual(computeReporterBond(0n), 0n, 'zero amount -> zero bond') && ok;
  ok = assertEqual(computeReporterBond(1n), 1n, '1 wei -> min 1 wei bond') && ok;
  ok = assertEqual(computeReporterBond(200n), 1n, '200 wei -> bond 1 wei (0.5% rounds down)') && ok;
  ok = assertEqual(computeReporterBond(10000n), 50n, '10000 wei -> bond 50 wei (0.5%)') && ok;

  if (!ok) {
    console.error('Some tests failed');
    process.exit(2);
  } else {
    console.log('All local tests passed');
  }
}

if (require.main === module) run();
