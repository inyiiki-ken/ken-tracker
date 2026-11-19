# Handoff from ChatGPT sessions (5–12 Nov 2026)

Written 19 Nov 2026 from the ChatGPT export. It covers what was changed or planned while working in ChatGPT.

## Already live (committed and pushed)
- `4959ddf` **Default unclassified sales to gold** (`lib/metal.ts`, `lib/optionsConfig.ts`). Items with no recognised metal now count as Gold in My Sales and Bossing. Set T.O.G to S-925 or Other to override.
  - The push succeeded, but **Vercel is not connected to GitHub**, so a push does not deploy. The manual `vercel deploy` failed with "Not authorized". Run `vercel.cmd login` first, then deploy. **Unconfirmed whether this is live.**

## Done locally, NOT committed, NOT deployed
1. **24K screenshot import fix** (`lib/masterlistOcr.ts`, `lib/masterlistImport.ts`, `components/UploadMasterlistFAB.tsx`, `lib/importReview.ts`)
   - The reader took AED 1,010 as grams on AMB21. It now reads the GOLD BAR column and flags unreadable weights or amount mismatches in the preview.
2. **Customer invoice shows store credit** (`components/InvoiceModal.tsx`, `InvoicePrintContent.tsx`, `lib/accountsLedger.ts`)
   - The invoice printed the full total without the carried-forward credit. Example: Carissa Murphy, AED 13,606 should show −394.28. It now prints "Store credit applied" and "Balance due" for every customer.
3. **Set store credit (manual override)** (`AccountsCustomerCard.tsx`, `AddShipmentPaymentDialog.tsx`, `lib/google-sheets/shipmentPayments.ts`, sheet-config, row-mapper, `types/index.ts`)
   - Accounts → customer → shipped batch → **Set store credit**. Enter a whole AED amount or restore the calculated credit. The original payment stays as received.
   - **To do after deploy:** set Carissa Murphy, Batch 1, to **AED 393**, then regenerate her "Unshipped / next shipment" invoice and send it.
4. **Audit fix DB-01: duplicate Row Keys could write to the wrong row** (`lib/google-sheets/recordStore.ts`). See `AUDIT_PROGRESS.md`.
5. **Other edits** to `app/page.tsx`, `AddClientModal.tsx`, `lib/orderCode.ts` (all-liver order codes and invoice payment precision), plus new check scripts.

Health on 19 Nov: `tsc` passes. All `scripts/check-*.cjs` pass except `check-masterlist-photo.cjs`, which needs a missing `.ocr-test` helper folder (setup issue, not an app bug).

Note: ChatGPT's 24K deploy command stripped a `crown` parameter from `parseMasterlistGrid` in its temp copy. The working copy keeps it. Deploy the working copy as a whole, not that patched command.

Leftover temp deploy folders: `node_modules/.cache/ken-tracker-invoice-deploy` and `ken-tracker-credit-deploy`. They're safe to delete.

## Planned, not built: Local Walk-In Partnerships
The partnership plan was later replaced by a **printed coupon** (Christmas theme, 5 AED/g MC discount, half-A5 landscape). The partner module is on hold. Agreed rules, if it's revived:
- Partners (AJA Salon, Kubo Restobar, Prime Medical) refer **walk-in** customers only. Live orders never count.
- Opening MC offer: AED 50/g (EF items 65). Confidential floor: AED 21/g retained after commission. Normal walk-in MC is 21, special 30, EF 55.
- Commission: AED 3–5/g, on the first qualifying purchase only, paid after Accounts verifies full payment. Settled monthly to the partner business.
- Referral is valid for 7 days from the first **confirmed physical visit**. No minimum grams. First valid recorded referral wins.
- Customers get a code before visiting, and the visit is confirmed with Ken. No mention means a normal walk-in.
- Partner staff (employee privilege): −10 MC on the agreed rate, no commission.
- The full build prompt is in the ChatGPT conversation "Salon Collaboration Plan" (7 Nov). The click-through prototype was not saved in this repo.
