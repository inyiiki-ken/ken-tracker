"use client";

import { DatabaseRowType } from '@/types';
import { calcShippingFee, isPcItem, getQty, clientRateAED, isFreeSf, isPromoSf, calcTotalPaid, getEffectiveCurrency, getPaymentCurrency } from '@/lib/calculations';
import { getUsdToAed, getCcSurchargeRate } from '@/lib/pricingConfig';
import { getRatesForDate } from '@/lib/ratesStore';
import { numberToWords } from '@/lib/numberToWords';
import { formatDate } from '@/lib/formatters';
import { parseBillingModifiers, getTotalChargesAED, getTotalDiscountsAED } from '@/lib/billingModifiers';
import { brandInitials } from '@/lib/brandSettings';
import { useBrand } from '@/components/BrandThemeLoader';

interface Props {
  records: DatabaseRowType[];
  currency: string;
  ccIncludeShipping?: boolean;
}

const NOTES = [
  'We can hold unpaid items for a maximum of 3 days from the invoice date if details are provided. If no details are provided, the order will be cancelled within 24 hours.',
  'Failure to settle within 3 days may result in additional charges.',
  'All items undergo strict quality checking before dispatch.',
  'An UNBOXING VIDEO is strictly required. No video, no refund, no exchange.',
  'No cash refund. Store credit only.',
  'Non Refundable for LA items once the payments is verified and decided not to continue the purchased. Please decide wisely.',
  'For international shipments, shipping fees, duties, and taxes are the responsibility of the customer.',
];

const n = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const rnd = (v: number) => Math.round(v);

/**
 * C2 FIX: Compute item amount in PHP using the same path as calculations.ts.
 * Round only the FINAL amount, not intermediate rate, to avoid rounding discrepancies.
 */
function calcPhpItemAmount(r: DatabaseRowType): number {
  const rRates = getRatesForDate(r.dateOfLive || '');
  const rateAED = clientRateAED(r);
  const cat = (r.category || '').toLowerCase().trim();
  const isScrewType = cat.includes('screw type');
  const isPerPc = cat.includes('per pc');
  const isPc = isPcItem(r);
  const g = n(r.grams);
  const qty = getQty(r);

  // Calculate total in AED first, then convert to PHP at the end
  let totalAED: number;
  if (isScrewType || isPerPc) totalAED = rateAED * qty;
  else if (isPc || g === 0) totalAED = rateAED;
  else totalAED = rateAED * g;

  // Single conversion + single round at the end
  return rnd(totalAED * rRates.phpRate);
}

export default function InvoicePrintContent({ records, currency, ccIncludeShipping = false }: Props) {
  const { settings, invoiceLogo, headerLogo, pageLogos } = useBrand();
  const BRAND_NAME = `${settings.companyName.toUpperCase()} ${settings.legalSuffix}`;
  const WATERMARK_TEXT = `${settings.companyName.toUpperCase()} OFFICIAL`;
  const first = records[0];
  // Per-page brand logo (if set for this invoice's page), else the default invoice logo.
  // Then the header logo, so a customer with only one logo still gets it on invoices.
  const effectiveLogo = (first?.page && pageLogos[first.page]) || invoiceLogo || headerLogo;

  // Use the most recent record's rate snapshot for invoice-level conversions (e.g. shipping).
  const latestRecord = records.reduce((latest, r) => {
    if (!latest?.dateOfLive) return r;
    if (!r.dateOfLive) return latest;
    return r.dateOfLive > latest.dateOfLive ? r : latest;
  }, first);
  const dailyRates = getRatesForDate(latestRecord?.dateOfLive || '');
  const phpRate = dailyRates.phpRate;

  const convertFromAED = (aedValue: number): number => {
    if (currency === 'PHP') return aedValue * phpRate;
    if (currency === 'USD') return aedValue / getUsdToAed();
    return aedValue;
  };

  const fmtAmt = (v: number) =>
    `${currency} ${rnd(v).toLocaleString('en-US')}`;

  const items = records.map(r => {
    const category = (r.category || '').toLowerCase().trim();
    const isScrewType = category.includes('screw type');
    const isPerPc = category.includes('per pc');
    const isDiamond = category.includes('diamond');
    const isPc = isPcItem(r);
    const gramsValue = n(r.grams);
    const qtyValue = getQty(r);

    // Use per-record rates so each item reflects its own date's PHP rate
    const recordRates = getRatesForDate(r.dateOfLive || '');
    const convertFromAEDForRecord = (aedValue: number): number => {
      if (currency === 'PHP') return aedValue * recordRates.phpRate;
      if (currency === 'USD') return aedValue / getUsdToAed();
      return aedValue;
    };

    // Display rate: if the invoice currency matches the record's stored currency,
    // use the raw clientRate directly to avoid AED round-trip snap inflation.
    // Otherwise convert via AED for cross-currency invoices.
    const effectiveCurr = getEffectiveCurrency(r);
    const displayRate = (currency === effectiveCurr && n(r.clientRate) > 0)
      ? rnd(n(r.clientRate))
      : rnd(convertFromAEDForRecord(clientRateAED(r)));

    // Amount: rate × grams/qty — always consistent with the displayed Rate column
    // Diamonds are per-piece (rate × qty), matching calcItemPriceAED logic.
    let amount: number;
    if (isScrewType || isPerPc || isDiamond) {
      amount = rnd(displayRate * qtyValue);
    } else if (isPc || gramsValue === 0) {
      amount = displayRate;
    } else {
      amount = rnd(displayRate * gramsValue);
    }

    let gramsDisplay = '';
    if (isScrewType || isPerPc) {
      gramsDisplay = `${qtyValue} PC${qtyValue > 1 ? 'S' : ''}`;
    } else if (isDiamond) {
      gramsDisplay = gramsValue > 0 ? gramsValue.toFixed(2) : `${qtyValue} PC`;
    } else {
      gramsDisplay = (isPc || gramsValue === 0) ? 'PC' : gramsValue.toFixed(2);
    }

    return {
      code: r.orderId || '—',
      desc: r.itemDescription || '—',
      tog: r.tog || r.category || '—',
      gramsDisplay,
      isPc: (isPc || isScrewType || isPerPc),
      rate: displayRate,
      amount,
      liver: r.liverName?.trim() || '',
      date: formatDate(r.dateOfLive),
      mop: (r.modeOfPayment || '').trim().toUpperCase().replace(/\s*\(.*?\)\s*/g, '').trim(),
    };
  });

  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  // Promo SF takes priority: find the record that has it set (may not be `first`)
  const promoRecord = records.find(r => isPromoSf(r));
  const anyFreeSf = !promoRecord && records.some(r => isFreeSf(r));
  const shippingAED = anyFreeSf ? 0 : calcShippingFee(promoRecord || first);
  // ── Billing Modifiers: parse charges, discounts, and shipping overrides ──
  // Collect all billing modifiers across records
  const allModifiers = records.map(r => parseBillingModifiers(r.additionalCharges));
  const shipFeeOverride = allModifiers.find(m => m.shipFeeOverride)?.shipFeeOverride;

  let shippingDisplay: number;
  if (shipFeeOverride) {
    let overrideAED = shipFeeOverride.amount;
    if (shipFeeOverride.currency === 'PHP') overrideAED = shipFeeOverride.amount / phpRate;
    else if (shipFeeOverride.currency === 'USD') overrideAED = shipFeeOverride.amount * getUsdToAed();
    shippingDisplay = currency === 'USD' ? Math.ceil(overrideAED / getUsdToAed()) : currency === 'PHP' ? Math.round(overrideAED * phpRate) : Math.round(overrideAED);
  } else {
    shippingDisplay = currency === 'USD' ? Math.ceil(convertFromAED(shippingAED)) : rnd(convertFromAED(shippingAED));
  }
  const shipping = shippingDisplay;

  // Sum charges and discounts across all records
  const additionalAED = allModifiers.reduce((s, m) => s + getTotalChargesAED(m, phpRate), 0);
  const discountAED = allModifiers.reduce((s, m) => s + getTotalDiscountsAED(m, phpRate), 0);
  const additional = rnd(convertFromAED(additionalAED));
  const discountDisplay = rnd(convertFromAED(discountAED));

  // Collect charge/discount descriptions for the invoice
  const chargeDescriptions: { label: string; amount: number }[] = [];
  const discountDescriptions: { label: string; amount: number }[] = [];
  for (const m of allModifiers) {
    for (const c of m.charges) {
      let aed = c.amount;
      if (c.currency === 'PHP') aed = c.amount / phpRate;
      else if (c.currency === 'USD') aed = c.amount * getUsdToAed();
      chargeDescriptions.push({ label: c.description || 'Additional Charge', amount: rnd(convertFromAED(aed)) });
    }
    for (const d of m.discounts) {
      let aed = d.amount;
      if (d.currency === 'PHP') aed = d.amount / phpRate;
      else if (d.currency === 'USD') aed = d.amount * getUsdToAed();
      discountDescriptions.push({ label: d.description || 'Discount', amount: rnd(convertFromAED(aed)) });
    }
  }
  const hasCcItems = records.some(r => (r.modeOfPayment || '') === 'Credit Card');
  const ccItemsTotal = items.reduce((s, item, idx) => {
    const r = records[idx];
    if ((r.modeOfPayment || '') !== 'Credit Card') return s;
    return s + item.amount;
  }, 0);
  // When ccIncludeShipping is true, apply 5% on (cc items + shipping); otherwise just cc items
  const ccBase = ccIncludeShipping && hasCcItems ? ccItemsTotal + shipping : ccItemsTotal;
  const ccFee = rnd(ccBase * getCcSurchargeRate());
  const total = subtotal + shipping + additional - discountDisplay + ccFee;

  // Compute total paid (display currency) — use calcTotalPaid which correctly handles
  // layaway vs non-layaway (avoids double-counting la1-4 payments + amountReceived)
  const totalPaidConverted = records.reduce((s, r) => {
    const paidAED = calcTotalPaid(r);
    const snap = getRatesForDate(r.dateOfLive || '');
    let converted: number;
    if (currency === 'PHP') converted = paidAED * snap.phpRate;
    else if (currency === 'USD') converted = paidAED / getUsdToAed();
    else converted = paidAED;
    return s + rnd(converted);
  }, 0);
  const totalPaidConverted_rounded = rnd(totalPaidConverted);

  // ─── PHP CANONICAL BALANCE CHECK ────────────────────────────────────────────
  const allPhpPayments = totalPaidConverted_rounded > 0 &&
    records.every(r => {
      const mop = (r.modeOfPayment || '').toLowerCase().trim();
      return mop === 'gcash' || mop === 'bank transfer php';
    });
  let isCanonicallyPaid = false;
  if (allPhpPayments && currency !== 'PHP') {
    const phpItemAmounts = records.map(r => calcPhpItemAmount(r));
    const phpSubtotal = phpItemAmounts.reduce((s, a) => s + a, 0);
    const phpShipping = anyFreeSf ? 0 : rnd(calcShippingFee(promoRecord || first) * phpRate);
    const phpAdditional = rnd((additionalAED - discountAED) * phpRate); // net charges in PHP
    const phpCcItemsTotal = phpItemAmounts.reduce((s, amt, idx) => {
      const r = records[idx];
      return (r.modeOfPayment || '') === 'Credit Card' ? s + amt : s;
    }, 0);
    const phpCcBase = ccIncludeShipping && hasCcItems ? phpCcItemsTotal + phpShipping : phpCcItemsTotal;
    const phpCcFee = rnd(phpCcBase * getCcSurchargeRate());
    const phpTotal = phpSubtotal + phpShipping + phpAdditional + phpCcFee;
    const phpPaid = records.reduce((s, r) =>
      s + n(r.downpayment) + n(r.la1MonthPayment) + n(r.la2MonthPayment) +
      n(r.la3MonthPayment) + n(r.la4MonthPayment) + n(r.amountReceived), 0);
    isCanonicallyPaid = Math.abs(phpTotal - rnd(phpPaid)) < 1;
  }
  // ────────────────────────────────────────────────────────────────────────────

  // When canonically paid: force displayed paid = total so all 3 rows are consistent.
  // (Avoids showing e.g. Total=332, Paid=333, Balance=0 which looks wrong.)
  const displayedPaid = isCanonicallyPaid ? total : totalPaidConverted_rounded;
  const balanceDue = isCanonicallyPaid ? 0 : total - totalPaidConverted_rounded;

  const totalGrams = records.reduce((s, r) => {
    const cat = (r.category || '').toLowerCase();
    if (cat.includes('screw type') || cat.includes('per pc')) return s;
    return s + n(r.grams);
  }, 0);

  const clampedBalance = Math.max(0, balanceDue);
  const isStoreCredit = displayedPaid > 0 && balanceDue < 0;
  const isLayaway = records.every(r => r.status === 'Layaway');
  const isTabbyTamara = records.every(r => {
    const mop = (r.modeOfPayment || '').toLowerCase().trim();
    return mop === 'tabby' || mop === 'tamara';
  });

  // Compute total downpayment in display currency (for layaway invoices only)
  const totalDownpaymentDisplay = isLayaway ? records.reduce((s, r) => {
    const dpRaw = n(r.downpayment);
    if (dpRaw <= 0) return s;
    const snap = getRatesForDate(r.dateOfLive || '');
    const dpCurr = getPaymentCurrency(r);
    let dpAED: number;
    if (dpCurr === 'PHP') dpAED = dpRaw / snap.phpRate;
    else if (dpCurr === 'USD') dpAED = dpRaw * getUsdToAed();
    else dpAED = dpRaw;
    if (currency === 'PHP') return s + rnd(dpAED * snap.phpRate);
    if (currency === 'USD') return s + rnd(dpAED / getUsdToAed());
    return s + rnd(dpAED);
  }, 0) : 0;

  // TOTAL INVOICE AMOUNT = full total (subtotal + shipping + fees), always
  const totalInvoiceDisplay = total;
  // Amount in words = TOTAL INVOICE AMOUNT (the full invoice total)
  const amountForWords = totalInvoiceDisplay;
  const amountInWords = numberToWords(amountForWords, currency);

  const uniqueMops = [...new Set(items.map(i => i.mop).filter(Boolean))];
  const mixedMops = uniqueMops.length > 1;

  const mopLabel = (() => {
    if (isLayaway) return null;
    if (mixedMops) return null;
    const mop = (first?.modeOfPayment || '').trim().toUpperCase().replace(/\s*\(.*?\)\s*/g, '').trim();
    if (!mop) return null;
    return mop;
  })();

  const invoiceDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const invoiceNo = records.map(r => r.pureWeight).find(Boolean);
  const brandName = BRAND_NAME;
  const watermarkText = WATERMARK_TEXT;

  const summaryRows: { label: string; value: string; red?: boolean; green?: boolean }[] = [
    { label: 'TOTAL GRAMS', value: totalGrams > 0 ? totalGrams.toFixed(2) : '—' },
    { label: 'SHIPPING', value: shipping > 0 ? fmtAmt(shipping) : 'FREE' },
    // Itemized charge descriptions
    ...chargeDescriptions.map(c => ({ label: c.label.toUpperCase(), value: fmtAmt(c.amount) })),
    // Itemized discount descriptions
    ...discountDescriptions.map(d => ({ label: `DISCOUNT: ${d.label.toUpperCase()}`, value: `- ${fmtAmt(d.amount)}`, green: true })),
    ...(ccFee > 0 ? [{ label: 'CC SURCHARGE', value: fmtAmt(ccFee) }] : []),
    { label: 'SUBTOTAL', value: fmtAmt(subtotal) },
    // TOTAL INVOICE AMOUNT is always the full total (subtotal + shipping + fees)
    { label: 'TOTAL INVOICE AMOUNT', value: fmtAmt(totalInvoiceDisplay) },
    // TOTAL PAID shown after invoice total
    ...(displayedPaid > 0 ? [{ label: 'TOTAL PAID', value: `- ${fmtAmt(displayedPaid)}`, red: true }] : []),
    // Balance / store credit
    ...(isStoreCredit
      ? [{ label: '🎁 STORE CREDIT', value: `- ${fmtAmt(Math.abs(balanceDue))}`, red: false, green: true }]
      : (clampedBalance > 0 && clampedBalance < totalInvoiceDisplay) ? [{ label: 'BALANCE DUE', value: fmtAmt(clampedBalance), red: true }] : []),
  ];

  const emptyRows = Math.max(0, 7 - items.length);

  return (
    <div style={{ position: 'relative', fontFamily: 'Arial, sans-serif', color: '#111', background: '#fff', fontSize: 12 }}>
      
      <div style={{
        position: 'absolute',
        top: '40%',
        left: '50%',
        transform: 'translate(-50%, -50%) rotate(-35deg)',
        fontSize: '65px',
        color: 'rgba(150, 150, 150, 0.12)',
        fontWeight: 900,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 0,
        userSelect: 'none',
        textAlign: 'center'
      }}>
        {watermarkText}<br/>
        {invoiceNo || ''}
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', border: '1px solid #999', padding: '4px', marginBottom: 0, background: '#fff' }}>
          <em style={{ fontSize: 14 }}>Statement of Account</em>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'transparent' }}>
          <tbody>
            <tr>
              <td style={{ width: '65%', padding: '12px 16px', verticalAlign: 'top', border: '1px solid #999' }}>
                <div style={{ fontWeight: 900, fontSize: 24, letterSpacing: 1 }}>{brandName}</div>
                <div style={{ marginTop: 8, textAlign: 'left', fontSize: 11 }}>{(settings.invoiceAddress?.trim() || settings.location).toUpperCase()}</div>
                {settings.invoiceContact?.trim() && (
                  <div style={{ marginTop: 4, fontSize: 11 }}>WhatsApp &amp; Contact no.: {settings.invoiceContact.trim()}</div>
                )}
              </td>
              <td style={{ width: '35%', padding: '12px 16px', verticalAlign: 'middle', textAlign: 'center', border: '1px solid #999' }}>
                {effectiveLogo ? (
                  <img src={effectiveLogo} alt={settings.companyName} style={{ width: '80px', height: '80px', objectFit: 'contain', margin: '0 auto', display: 'block' }} />
                ) : (
                  <div style={{ width: '80px', height: '80px', borderRadius: '12px', backgroundColor: '#0f7a5f', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                    <span style={{ fontFamily: 'Cinzel, serif', fontSize: '28px', fontWeight: 900, color: '#fff', letterSpacing: '2px' }}>{brandInitials(settings.companyName)}</span>
                  </div>
                )}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '10px 16px', verticalAlign: 'middle', border: '1px solid #999' }}>
                <div style={{ fontWeight: 700, fontSize: 20, textAlign: 'center', letterSpacing: 1 }}>
                  {(first?.minerName || '').toUpperCase()}
                </div>
                {(first?.clientAddress || first?.clientNumber) && (
                  <div style={{ fontSize: 11, textAlign: 'center', marginTop: 4, color: '#333' }}>
                    {first?.clientAddress}
                    {first?.clientAddress && first?.clientNumber ? ' · ' : ''}
                    {first?.clientNumber}
                  </div>
                )}
              </td>
              <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #999' }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{invoiceDate}</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>Date Printed</div>
                {invoiceNo && (
                  <div style={{ marginTop: 8, borderTop: '1px solid #ccc', paddingTop: 6 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, fontFamily: 'monospace', color: '#c00' }}>{invoiceNo}</div>
                    <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>Account ID / Invoice #</div>
                  </div>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'transparent' }}>
          <thead>
            <tr style={{ background: 'rgba(224, 224, 224, 0.9)' }}>
              {['Date', 'Item Description', 'T.O.G', 'Grams/Qty', 'Rate', 'Amount'].map(h => (
                <th key={h} style={{ border: '1px solid #999', padding: '6px 8px', textAlign: 'center', fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i}>
                <td style={{ border: '1px solid #999', padding: '5px 8px', textAlign: 'center', fontSize: 11, color: '#666' }}>{item.date}</td>
                <td style={{ border: '1px solid #999', padding: '5px 8px', textAlign: 'center', fontSize: 11, fontWeight: 600 }}>
                  {item.desc.toUpperCase()}
                  {item.liver && <div style={{ fontSize: 9, fontWeight: 400, color: '#888', marginTop: 2 }}>Liver: {item.liver}</div>}
                  {mixedMops && item.mop && (
                    <div style={{ marginTop: 4, display: 'flex', justifyContent: 'center' }}>
                      <span style={{ display: 'inline-block', border: '1.5px solid red', color: 'red', padding: '1px 6px', fontWeight: 900, fontSize: 8, letterSpacing: '1px', transform: 'rotate(-4deg)', transformOrigin: 'center' }}>
                        {item.mop}
                      </span>
                    </div>
                  )}
                </td>
                <td style={{ border: '1px solid #999', padding: '5px 8px', textAlign: 'center', fontSize: 11 }}>{item.tog.toUpperCase()}</td>
                <td style={{ border: '1px solid #999', padding: '5px 8px', textAlign: 'center', fontSize: 11, color: item.isPc ? 'red' : '#111', fontWeight: item.isPc ? 700 : 400 }}>
                  {item.gramsDisplay}
                </td>
                <td style={{ border: '1px solid #999', padding: '5px 8px', textAlign: 'center', fontSize: 11 }}>{item.rate.toLocaleString('en-US')}</td>
                <td style={{ border: '1px solid #999', padding: '5px 8px', textAlign: 'right', fontSize: 11 }}>{fmtAmt(item.amount)}</td>
              </tr>
            ))}
            {Array.from({ length: emptyRows }).map((_, i) => (
              <tr key={`empty-${i}`} style={{ height: 22 }}>
                {[1,2,3,4,5,6].map(c => <td key={c} style={{ border: '1px solid #999' }}>&nbsp;</td>)}
              </tr>
            ))}
          </tbody>
        </table>

        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'transparent' }}>
          <tbody>
            <tr>
              <td style={{ width: '50%', padding: '16px', verticalAlign: 'middle', border: '1px solid #999' }}>
                <div style={{ fontWeight: 900, fontSize: 26, lineHeight: 1.2, textAlign: 'center' }}>
                  CUSTOMER'S INVOICE<br />COPY
                </div>
                {mopLabel && (
                  <div style={{ marginTop: '8px', textAlign: 'center' }}>
                    <div style={{ display: 'inline-block', border: '2px solid red', color: 'red', padding: '4px 12px', fontWeight: 900, fontSize: '18px', letterSpacing: '2px', textTransform: 'uppercase' }}>
                      {mopLabel}
                    </div>
                  </div>
                )}
                {isLayaway && (
                  <div style={{ marginTop: '8px', textAlign: 'center' }}>
                    <div style={{ display: 'inline-block', border: '3px solid #7c3aed', color: '#7c3aed', padding: '4px 14px', fontWeight: 900, fontSize: '18px', letterSpacing: '3px', transform: 'rotate(-5deg)', transformOrigin: 'center' }}>
                      LAYAWAY
                    </div>
                  </div>
                )}
              </td>
              <td style={{ padding: 0, verticalAlign: 'top', border: '1px solid #999' }}>
                {summaryRows.map((row, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', background: row.green ? 'rgba(220, 252, 231, 0.9)' : row.red ? 'rgba(255, 240, 240, 0.9)' : (i % 2 === 0 ? 'rgba(224, 224, 224, 0.9)' : 'rgba(245, 245, 245, 0.9)'), padding: '5px 10px', borderBottom: '1px solid #ccc' }}>
                    <span style={{ fontWeight: 700, fontSize: 11, color: row.green ? '#166534' : row.red ? '#cc0000' : '#111' }}>{row.label}</span>
                    <span style={{ fontSize: 11, fontWeight: (row.red || row.green) ? 700 : 400, color: row.green ? '#166534' : row.red ? '#cc0000' : '#111' }}>{row.value}</span>
                  </div>
                ))}
              </td>
            </tr>
          </tbody>
        </table>

        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'transparent' }}>
          <tbody>
            <tr>
              <td style={{ padding: '4px 12px', border: '1px solid #999', borderBottom: 'none' }}>
                <span style={{ color: 'red', fontWeight: 700, fontSize: 11 }}>
                  {'Amount in Words:'}
                </span>
              </td>
            </tr>
            <tr>
              <td style={{ padding: '4px 12px 10px', textAlign: 'center', fontWeight: 700, fontSize: 13, border: '1px solid #999' }}>
                {amountInWords}
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ padding: '8px 12px', border: '1px solid #999', marginTop: -1, background: '#fff' }}>
          <div style={{ color: 'red', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>NOTE:</div>
          {NOTES.map((note, i) => (
            <div key={i} style={{ fontSize: 10, marginBottom: 2 }}>{i + 1}. {note}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
