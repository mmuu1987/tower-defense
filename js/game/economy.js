// Integer allocations preserve the full budget, including zero-value tickets.
export function allocateBudget(total, weights) {
  if (!Number.isSafeInteger(total) || total < 0 || !weights.length || weights.some((w) => !Number.isFinite(w) || w < 0)) throw new Error('Invalid budget allocation');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error('Budget weights must be positive');
  const exact = weights.map((w) => total * w / sum);
  const amounts = exact.map(Math.floor);
  const order = exact.map((value, i) => ({ i, remainder: value - amounts[i] }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (let i = 0, rest = total - amounts.reduce((a, b) => a + b, 0); i < rest; i++) amounts[order[i].i]++;
  return amounts;
}

const INCOME = new Set(['kill', 'clear', 'early', 'sell']);
const SPENDING = new Set(['build', 'upgrade']);
export class EconomyLedger {
  constructor(startGold) {
    if (!Number.isSafeInteger(startGold) || startGold < 0) throw new Error('Invalid starting gold');
    this.balance = startGold;
    this.startGold = startGold;
    this.entries = [];
    this.ids = new Set();
    this.families = new Map();
    this.register({ id: 'opening', kind: 'opening', amount: 0, wave: 0, time: 0 });
  }

  register({ id, kind, amount, wave = 0, time = 0, ...detail }) {
    if (typeof id !== 'string' || !id || this.ids.has(id) || !Number.isSafeInteger(amount) ||
        !Number.isSafeInteger(this.balance + amount) || this.balance + amount < 0 || !Number.isInteger(wave) || wave < 0 ||
        !Number.isFinite(time) || time < 0 ||
        !(INCOME.has(kind) || SPENDING.has(kind) || kind === 'opening' || kind === 'adjustment') ||
        (INCOME.has(kind) && amount < 0) || (SPENDING.has(kind) && amount >= 0)) return false;
    this.balance += amount;
    const entry = Object.freeze({ ...detail, id, kind, amount, wave, time, balance: this.balance });
    this.ids.add(id);
    this.entries.push(entry);
    return true;
  }

  adjustTo(balance, detail = {}) {
    if (!Number.isSafeInteger(balance) || balance < 0) throw new Error('Invalid gold adjustment');
    return this.register({ ...detail, id: 'adjustment-' + this.entries.length, kind: 'adjustment', amount: balance - this.balance });
  }

  registerFamily(id, budget, tickets, detail = {}) {
    if (!id || this.families.has(id) || !Number.isSafeInteger(budget) || budget < 0 ||
        tickets.some((ticket) => !ticket.id || !Number.isSafeInteger(ticket.amount) || ticket.amount < 0) ||
        new Set(tickets.map((ticket) => ticket.id)).size !== tickets.length ||
        tickets.reduce((sum, ticket) => sum + ticket.amount, 0) > budget) return false;
    this.families.set(id, { ...detail, id, budget, paid: 0, tickets: new Map(tickets.map((t) => [t.id, t.amount])), settled: new Set() });
    return true;
  }

  claim(familyId, ticketId, detail = {}) {
    const family = this.families.get(familyId);
    if (!family || family.settled.has(ticketId) || !family.tickets.has(ticketId)) return null;
    const amount = family.tickets.get(ticketId);
    if (family.paid + amount > family.budget || !this.register({ ...detail, id: 'bounty:' + ticketId, kind: 'kill', amount, familyId, ticketId })) return null;
    family.settled.add(ticketId); family.paid += amount;
    return amount;
  }

  summary() {
    const totals = { kill: 0, clear: 0, early: 0, sell: 0, build: 0, upgrade: 0, adjustment: 0 };
    const waves = new Map();
    let expected = this.startGold;
    for (const entry of this.entries) {
      if (entry.kind in totals) totals[entry.kind] += SPENDING.has(entry.kind) ? -entry.amount : entry.amount;
      if (!waves.has(entry.wave)) waves.set(entry.wave, { wave: entry.wave, opening: expected, income: 0, spending: 0, adjustment: 0, closing: expected });
      const row = waves.get(entry.wave);
      if (INCOME.has(entry.kind)) row.income += entry.amount;
      if (SPENDING.has(entry.kind)) row.spending -= entry.amount;
      if (entry.kind === 'adjustment') row.adjustment += entry.amount;
      expected += entry.amount;
      row.closing = expected;
    }
    return { startGold: this.startGold, balance: this.balance, totals, expected, balanced: expected === this.balance,
      income: totals.kill + totals.clear + totals.early + totals.sell, spending: totals.build + totals.upgrade,
      familyBudget: [...this.families.values()].reduce((sum, family) => sum + family.budget, 0),
      familyPaid: [...this.families.values()].reduce((sum, family) => sum + family.paid, 0),
      familyViolations: [...this.families.values()].filter((family) => family.paid > family.budget).length,
      waves: [...waves.values()] };
  }
}
