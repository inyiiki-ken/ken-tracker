# CROWN audit — ongoing, 6 November 2026

This is an interim evidence log, not a completed audit or production certification. No production data or permissions were changed; no deployment was performed. A usable production backup and restore procedure have not yet been verified.

## Verified repair

**DB-01 — High: ambiguous duplicate Row Keys could target the wrong record.**

Location: `lib/google-sheets/recordStore.ts`, `writeRowsByCells`.
Reproduction: provide two rows with the same Row Key, retaining the caller's old row number as one of those rows. Previously the writer accepted that position despite the duplicate identity. A sort can put the other copy at that position. Expected: refuse the ambiguous write before changing cells.

Root cause: `found.includes(u.rowNumber)` took precedence over duplicate detection. Removed that shortcut. Unique keys still relocate correctly after sorting; missing keys still fail. No financial formulas changed.

Verification: offline simulated worksheets in `scripts/check-record-identity.cjs` cover duplicate keys at both matching positions and a different position, relocated unique keys, and missing keys. Rejected writes make zero saves. New checks passed, as did TypeScript, 19 existing accounts checks, 22 delivery-pricing checks, and masterlist category checks. These are controlled local tests, not live persistence tests. Rollback: restore the removed positional shortcut from the Git diff (not recommended).

## Findings requiring further investigation

- Authorization source supports `DISABLE_SERVER_AUTHZ=true`, which bypasses central checks. Production setting has not been inspected; exposure is not established.
- Role cache permits stale permissions during read failures (up to five minutes for role checks and thirty minutes for record access). Revocation timing needs controlled role-session tests; no permissions were changed.
- Sheet write queue is process-local. It cannot serialize concurrent writes across independent server instances. Distributed concurrency safety remains unverified.
- Row audit history is trimmed to twenty entries. Long-term audit retention and backups require verification.
- Live Accounts shows 71 customers under Needs review. This is an application flag, not proof of 71 financial errors. Reconciliation with source records remains outstanding.

## Module coverage matrix

PASS below applies only to the named check. End-to-end approval remains NOT TESTED throughout.

| Module | Inspection so far | Test status |
|---|---|---|
| Admin | Live overview, pipeline counters and controls observed; source located | NOT TESTED workflows |
| Dispatch | Source components and write actions located | PASS related delivery-pricing unit checks; live workflow NOT TESTED |
| Accounts | Live overview, filters, tabs and customer summary controls observed | PASS 19 ledger cases; persistence NOT TESTED |
| Bossing | Navigation and source located | NOT TESTED |
| Liver | Navigation and source located | NOT TESTED |
| Purchasing | Navigation/source; server role gates located | NOT TESTED |
| Invoicing | Navigation/source and invoice-number action located | NOT TESTED |
| Gold Room | Navigation and liveSellers components located | NOT TESTED |
| Settings | Navigation and configuration actions located | NOT TESTED |
| God Mode | Navigation and components located | NOT TESTED |
| Imports/exports | Source located | PASS existing category checks; live round trip NOT TESTED |
| Shared record writer | Duplicate identity defect repaired locally | PASS offline identity cases |
| Authentication | Google NextAuth and server authorization source partially inspected | NOT TESTED adversarial role sessions |
| Google Sheets | Open Crown Masterlist tab identified; storage helpers partially inspected | NOT TESTED live schema/reconciliation/restore |

## Next work

Complete the feature/control inventory and read-only module walkthrough; trace tenant routing and every exported server action; inspect spreadsheet schema without triggering auto-creation or repair helpers; verify backup/restore on an isolated copy; test financial boundary cases and cross-module workflows with disposable fixtures. Record individual control outcomes rather than inferring success from pages loading. Deployment, real transactions, destructive operations, production migrations and permission changes remain outside authorized testing.

## 7 November — AMBIE photo import correction

At the owner's request, corrected nine Category cells in the Crown Database tab for the 7 November 2026 AMBIE batch. AMB03, AMB04, AMB06, AMB07, AMB11, AMB12 and AMB13 changed from Special Price to Gold Normal. AMB02 and AMB10 changed from Special Price EF to Special Price. A read-back verified all nine categories and matching Row Keys, MC and client rates. The guarded update reported nine changed cells. The local rollback file is `outputs/ambie-category-backup-1794074024495.json`.

Updated the photo import and preview edit paths to apply the same tenant pricing rules as workbook uploads. Fixed fallback classification when MC is calculated from the amount. The category regression suite includes the numeric MC sequence from this batch. Local category tests and type checking passed.
