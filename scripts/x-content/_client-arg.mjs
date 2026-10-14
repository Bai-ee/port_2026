// Shared `--client <id>` for inventory scripts (multi-client Phase 3a): required, validated, no owner default.
// Exits 1 with a usage line when missing, so a script can never write rows under a guessed client.
export function requireClientArg(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--client');
  const id = i > -1 ? String(argv[i + 1] || '').trim() : '';
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) {
    console.error('--client <clientId> is required (inventory rows are per client; there is no default).');
    process.exit(1);
  }
  return id;
}
