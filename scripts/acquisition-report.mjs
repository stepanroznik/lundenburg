// Presentation only: never include provider URLs, credentials or raw metadata.
export const safeText = value => String(value ?? '').normalize('NFC').replace(/https?:\/\/\S+/gi, '[URL]')
  .replace(/(?:token|password|api[_-]?key|signature)\s*[=:]\s*\S+/gi, '[redacted]')
  .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();
export const gib = bytes => `${(bytes / 2 ** 30).toFixed(1)} GiB`;
export const hours = ms => `${(ms / 3600000).toFixed(1)}h`;
export function table(headers, rows) {
  const cells = [headers, ...rows].map(row => row.map(safeText));
  const widths = headers.map((_, i) => Math.max(...cells.map(row => Array.from(row[i] ?? '').length)));
  const line = row => row.map((s, i) => s + ' '.repeat(widths[i] - Array.from(s).length)).join('  ').trimEnd();
  return [line(cells[0]), widths.map(n => '-'.repeat(n)).join('  '), ...cells.slice(1).map(line)].join('\n');
}
export function renderReport(r) {
  const time = value => value ? new Intl.DateTimeFormat('en-GB', { timeZone: r.timeZone, dateStyle: 'short', timeStyle: 'medium' }).format(Number(value)) : 'not recorded';
  const out = [`Acquisition · ${time(r.at)} · ${safeText(r.activity)}`];
  for (const d of r.downloads) out.push(`Downloading: ${safeText(d.programme)} — ${safeText(d.title)}\n  ${gib(d.downloadedBytes)} received; last progress ${d.lastProgressSecondsAgo}s ago (total size unknown)`);
  out.push(`Next automatic check: ${r.nextRun && r.nextRun <= r.at ? 'due now' : time(r.nextRun)}${r.workerActive ? ' (current batch is running)' : ''}`);
  out.push(`Last discovery: ${time(r.lastDiscovery)} · Inventory: ${r.inventoryComplete ? 'complete' : 'incomplete'} · Schedule publication: ${r.publicationPending ? 'pending' : 'no pending changes'}`);
  const usable = r.shows.reduce((n, s) => n + s.have, 0), added = r.shows.reduce((n, s) => n + s.added, 0);
  out.push(`Library: ${usable} usable episodes; ${added} acquired · Automatic queue: ${r.readyTotal} ready, ${r.shows.reduce((n, s) => n + s.later, 0)} waiting for retry`);
  const short = text => Array.from(text).length > 28 ? Array.from(text).slice(0, 27).join('') + '…' : text;
  out.push('', table(['Show', 'Lang', 'Have/Goal', 'New', 'Hours', 'Size', 'Ready', 'Later', 'Blocked', 'Plan'], r.shows.map(s => [
    s.title, s.language, `${s.have}/${s.continuous ? '∞' : s.target}`, s.added, hours(s.durationMs), gib(s.bytes), s.ready, s.later, s.blocked, short(s.plan),
  ])));
  const editorial = r.shows.filter(s => s.rankCounts);
  if (r.classificationStatus) out.push(`\nClassification: ${safeText(r.classificationStatus)}`);
  if (editorial.length) out.push('\nEditorial decisions:', table(['Show', 'A+', 'A', 'B', 'C', 'D', 'X', 'Pending'],
    editorial.map(s => [s.title, ...['A+', 'A', 'B', 'C', 'D', 'X', 'pending'].map(rank => s.rankCounts[rank])])));
  out.push('\nHave = usable indexed episodes; New = downloaded episodes in Have. Ready/Later = eligible now/after retry delay.');
  out.push('Blocked = manual or quarantined candidates, including alternatives; candidate counts can exceed the collection target.');
  const cap = Number.isFinite(r.maxNewBytes) ? `${gib(r.maxNewBytes)} acquisition allowance` : 'no fixed byte cap; governed by disk reserve';
  out.push(`\nStorage: ${gib(r.newBytes)} / ${cap} (includes staging/quarantine)`);
  out.push(`Disk free: ${r.freeBytes === null ? 'unavailable' : gib(r.freeBytes)} · Keep free: ${(r.reserveBytes / 1e9).toFixed(1)} GB (${gib(r.reserveBytes)}) · Download limit: ${(r.rate / 2 ** 20).toFixed(1)} MiB/s`);
  out.push(`\nUp next (${r.readyTotal} eligible now; order can change after imports/discovery):`);
  out.push(r.next.length ? table(['Show', 'Episode', 'Rank', 'Attempts'], r.next.map(n => [n.show, n.title, n.rank ?? '', n.attempts])) : '  No eligible discovered episode right now; future discovery may find more.');
  if (r.earliestRetry) out.push(`Earliest eligible retry: ${time(r.earliestRetry)}`);
  out.push('\nWhy work is waiting / blocked:');
  out.push(r.reasons.length ? r.reasons.map(x => `  ${safeText(x.show)}: ${x.count} × ${safeText(x.reason)}`).join('\n') : '  No recorded blockers.');
  out.push('\nRecently acquired:');
  out.push(r.recent.length ? table(['When', 'Show', 'Episode', 'Size'], r.recent.map(x => [time(x.at), x.show, x.title, gib(x.bytes)])) : '  No acquired episodes recorded.');
  return out.join('\n');
}
