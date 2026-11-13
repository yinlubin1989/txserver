import { money, safe, sum } from './money';
import type { Detail, Item } from './ledger';

export type CommissionCheck = { status: 'matched' | 'mismatch' | 'incomplete' | 'inferred'; message: string };
export type CalculatedEntry = { recordIndex: number; item: Item; detail: Detail };
const DEFAULT_RATES = new Map([[28800, 4000], [36800, 6000]]);
function saleKey(entry: CalculatedEntry) { return `${entry.recordIndex}:${entry.item.id}`; }
function hasKnownAmount(item: Item) { return item.amount !== null || (item.unitPrice !== null && item.quantity !== null); }
function conflictsWithDailyPacket(source: string) {
  const text = source.normalize('NFKC').replace(/[\t \u00a0]/g, '');
  return /(?:不|未|没|无|非)[^，,。；;\n]{0,8}(?:含|包括|计入)[^，,。；;\n]{0,20}提成|提成[^，,。；;\n]{0,20}(?:另(?:外|行)?(?:计|付|算|支付)|单独(?:计|付|算|支付)|不在[^，,。；;\n]{0,12}红包)|另(?:外|行)?(?:计|付|算|支付)[^，,。；;\n]{0,12}提成/.test(text);
}

// Apply the shop's daily accounting policy after exact-record deduplication.
// Original amounts stay visible; only included flags and generated default fees affect accounting.
export function applyCommissionPolicy(entries: CalculatedEntry[], sources: string[]) {
  const packets = entries.filter(entry => entry.item.category === 'redPacket' && hasKnownAmount(entry.item));
  const hasPacket = packets.length > 0; // An explicitly written zero is still the actual daily amount.
  const packetCents = sum(packets.filter(entry => !entries.some(parent =>
    parent.recordIndex === entry.recordIndex && parent.item.id === entry.item.includedIn && parent.item.category === 'redPacket',
  )).map(entry => entry.detail.amountCents));
  const commissions = entries.filter(entry => entry.item.category === 'commission');
  const sales = entries.filter(entry => entry.item.category === 'income');
  const coveredByCommission = (entry: CalculatedEntry) => entries.some(parent =>
    parent.recordIndex === entry.recordIndex && parent.item.id === entry.item.includedIn && parent.item.category === 'commission',
  );
  const commissionValue = (entry: CalculatedEntry) => coveredByCommission(entry) ? 0 : entry.detail.amountCents;
  const hasPacketConflict = hasPacket && sources.some(conflictsWithDailyPacket);

  const linked = new Map<string, CalculatedEntry[]>();
  const unlinked: CalculatedEntry[] = [];
  for (const entry of commissions) {
    if (entry.item.commissionFor === null) unlinked.push(entry);
    else {
      const key = `${entry.recordIndex}:${entry.item.commissionFor}`;
      linked.set(key, [...(linked.get(key) ?? []), entry]);
    }
  }
  const generated: Detail[] = [];
  const formula: string[] = [];
  const expectedParts: number[] = [];
  const missing: string[] = [];
  // An unscoped written fee may already cover the standard-price sales. Keep it,
  // but do not add inferred fees on top of an amount whose scope is unknown.
  const hasUnscopedAmount = !hasPacket && unlinked.some(entry => hasKnownAmount(entry.item) && !coveredByCommission(entry));
  const activeSales = sales.filter(entry => linked.has(saleKey(entry)) || (!(entry.item.amount === null && entry.item.quantity === null) && entry.item.quantity !== 0));
  for (const sale of activeSales) {
    const overrides = linked.get(saleKey(sale)) ?? [];
    if (overrides.length) {
      const known = overrides.filter(entry => hasKnownAmount(entry.item));
      if (known.length) {
        if (known.length !== overrides.length) missing.push(`${sale.item.label}另有提成金额未填写`);
        const value = sum(known.map(commissionValue));
        expectedParts.push(value);
        const descriptions = known.map(entry => coveredByCommission(entry)
          ? `原文${money(entry.detail.amountCents)}已含于其他提成`
          : entry.detail.unitPriceCents !== null && entry.detail.quantity !== null
            ? `${entry.detail.quantity}束×${money(entry.detail.unitPriceCents)}`
            : money(entry.detail.amountCents));
        formula.push(`${sale.item.label}注明提成(${descriptions.join('＋')})`);
        continue;
      }
      // A blank annotation does not override an otherwise applicable default.
    }
    const { unitPriceCents, quantity, quantityUnit } = sale.detail;
    if (quantityUnit !== null && quantityUnit !== '束') continue;
    if (unitPriceCents === null || quantity === null || quantityUnit === null) {
      missing.push(`${sale.item.label}缺少单价、数量或花束单位`);
      continue;
    }
    const rate = DEFAULT_RATES.get(unitPriceCents);
    if (rate === undefined) {
      missing.push(`${money(unitPriceCents)}元花束未注明提成`);
      continue;
    }
    if (hasUnscopedAmount) {
      missing.push(`${sale.item.label}的默认提成可能已含于未注明归属的提成，为免重复未叠加补算`);
      continue;
    }
    const value = safe(rate * quantity);
    expectedParts.push(value);
    formula.push(`${quantity}束×${money(rate)}`);
    if (!hasPacket) generated.push({
      label: `${money(unitPriceCents)}元花束默认提成`, category: 'commission', amountCents: value,
      unitPriceCents: rate, quantity, quantityUnit: '束', source: sale.item.source, included: false,
      accountingNote: `按${money(unitPriceCents)}元花束每束${money(rate)}元补算：${quantity}束×${money(rate)}元＝${money(value)}元`,
    });
  }
  for (const entry of unlinked) {
    if (coveredByCommission(entry)) continue;
    if (!hasKnownAmount(entry.item)) missing.push(`${entry.item.label}提成金额未填写`);
    else {
      if (activeSales.length) missing.push(`${entry.item.label}未明确对应哪笔销售`);
      expectedParts.push(entry.detail.amountCents); formula.push(`注明提成${money(entry.detail.amountCents)}`);
    }
  }
  if (hasPacketConflict) missing.push('原文注明提成另计或不包含，与红包包含当日全部提成的规则存在冲突');

  const updatedEntries = entries.map(entry => {
    if (hasPacket && entry.item.category === 'commission') return {
      ...entry, detail: { ...entry.detail, included: true, accountingNote: '已包含于当日红包，未重复计入' },
    };
    return entry;
  });
  if (!formula.length && !missing.length && !commissions.length) return { entries: updatedEntries, generated, commissionCheck: null, reviewWarning: null };
  const expected = sum(expectedParts);
  const expression = formula.length ? `${formula.join('＋')}＝${money(expected)}元` : '已知提成0.00元';
  let commissionCheck: CommissionCheck;
  if (missing.length) {
    const reasons = [...new Set(missing)].join('；');
    commissionCheck = { status: 'incomplete', message: hasPacket
      ? `红包按原文${money(packetCents)}元计入；${reasons}，无法完整核对。已注明的提成不再叠加。${hasPacketConflict ? '支出和利润可能有误，请核对。' : ''}`
      : `未填写红包金额，已按可确定的默认规则和原文提成暂计：${expression}。${reasons}；无法确定的部分暂未计入，支出可能偏低、利润可能偏高，请核对。` };
  } else if (hasPacket) {
    const difference = safe(expected - packetCents);
    commissionCheck = { status: difference === 0 ? 'matched' : 'mismatch', message: `提成核对：${expression}；原文红包${money(packetCents)}元${difference === 0 ? '，核对一致' : `，规则金额与红包相差${money(difference)}元，仍按原文红包入账`}。` };
  } else {
    commissionCheck = { status: 'inferred', message: `未填写红包金额，按默认规则和原文提成补算：${expression}。` };
  }
  const reviewWarning = hasPacketConflict || (!hasPacket && missing.length > 0) ? commissionCheck.message : null;
  return { entries: updatedEntries, generated, commissionCheck, reviewWarning };
}
