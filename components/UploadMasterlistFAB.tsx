"use client";

import { useState, useRef, useMemo, useEffect } from 'react';
import { ProgressBar } from '@/components/ui/motion';
import { Upload, X, Loader2, CheckCircle, AlertTriangle, ArrowLeft, FileSpreadsheet, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { createUpload, importRows, recordLastImport, getLastImport, undoLastImport, checkDatabaseColumns, fixDatabaseColumns, type LastImportInfo } from '@/lib/api';
import { parseMasterlistFile, type ParsedMasterlistRow, type ParsedSheetSummary } from '@/lib/masterlistImport';
import { useDataOptions } from '@/lib/dataOptions';

interface Props {
  onRefresh: () => void;
}

interface Parsed {
  rows: ParsedMasterlistRow[];
  liverName: string;
  pageName: string;
  sheets: ParsedSheetSummary[];
}

/**
 * Parses the masterlist in the browser, shows a PREVIEW (per-sheet counts +
 * sample rows + validation warnings) and only writes to the sheet after the
 * user confirms — so a malformed file can't silently import bad rows.
 */
export default function UploadMasterlistFAB({ onRefresh }: Props) {
  const [open, setOpen] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [lastImport, setLastImport] = useState<LastImportInfo | null>(null);
  const [undoing, setUndoing] = useState(false);
  // Columns the app writes that this customer's Google Sheet doesn't have yet.
  const [missingCols, setMissingCols] = useState<string[]>([]);
  const [fixingCols, setFixingCols] = useState(false);

  // Whenever a preview is shown, check the customer's sheet has every column
  // the import writes (otherwise those values would be silently dropped).
  useEffect(() => {
    if (!parsed) { setMissingCols([]); return; }
    checkDatabaseColumns().then((r) => setMissingCols(r.missing || [])).catch(() => setMissingCols([]));
  }, [parsed]);

  const doFixColumns = async () => {
    setFixingCols(true);
    try {
      const r = await fixDatabaseColumns();
      if (!r.success) { toast.error(r.error || 'Could not update the sheet'); return; }
      toast.success(r.added.length ? `Added ${r.added.length} column(s) to the sheet: ${r.added.join(', ')}` : 'Sheet already has every column');
      setMissingCols([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the sheet');
    } finally {
      setFixingCols(false);
    }
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const dataOpts = useDataOptions();

  // Load the most recent (undoable) import whenever the panel opens.
  useEffect(() => {
    if (!open) return;
    getLastImport().then(setLastImport).catch(() => setLastImport(null));
  }, [open]);

  const reset = () => { setSelectedFile(null); setParsed(null); setProgress(null); };

  const doParse = async () => {
    if (!selectedFile) { toast.error('Please select a file'); return; }
    setParsing(true);
    try {
      const res = await parseMasterlistFile(selectedFile);
      if (res.rows.length === 0) {
        toast.error('No valid rows found. Check the file matches the masterlist format (data starts row 6).');
        return;
      }
      setParsed({ rows: res.rows, liverName: res.liverName, pageName: res.pageName, sheets: res.sheets });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read file');
    } finally {
      setParsing(false);
    }
  };

  // Validation warnings against the customer's DATA'S option lists.
  const warnings = useMemo(() => {
    if (!parsed) return { noPrice: 0, unknownCategories: [] as string[], unknownSources: [] as string[] };
    const catSet = new Set(dataOpts.categories.map((c) => c.toLowerCase()));
    const srcSet = new Set(dataOpts.sources.map((s) => s.toLowerCase()));
    const unknownCats = new Set<string>();
    const unknownSrc = new Set<string>();
    let noPrice = 0;
    for (const r of parsed.rows) {
      if (!(parseFloat(r.clientRate) > 0)) noPrice++;
      if (catSet.size && r.category && !catSet.has(r.category.toLowerCase())) unknownCats.add(r.category);
      if (srcSet.size && r.source && !srcSet.has(r.source.toLowerCase())) unknownSrc.add(r.source);
    }
    return { noPrice, unknownCategories: [...unknownCats].slice(0, 12), unknownSources: [...unknownSrc].slice(0, 12) };
  }, [parsed, dataOpts]);

  const doImport = async () => {
    if (!parsed) return;
    setImporting(true);
    const importId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const { rows, liverName, pageName, sheets } = parsed;
      let created = 0;
      const allErrors: string[] = [];
      const BATCH_SIZE = 100; // server appends the whole batch in one request
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        setProgress(`Importing ${i + 1}-${Math.min(i + BATCH_SIZE, rows.length)} of ${rows.length}…`);
        setPct(Math.round((i / rows.length) * 100));
        const result = await importRows({ rows: rows.slice(i, i + BATCH_SIZE) as unknown as Record<string, string>[], importId });
        created += result.createdCount;
        allErrors.push(...result.errors);
      }
      const sheetLabel = sheets.length > 1 ? `${sheets.length} sheets` : `${liverName} / ${pageName}`;
      const fileName = `${selectedFile?.name ?? 'masterlist'} (${sheetLabel})`;
      await createUpload({
        masterlistFile: fileName,
        status: allErrors.length ? `Processed ${created} items, ${allErrors.length} errors` : `Processed ${created} items`,
      });
      // Remember this batch so it can be undone in one click.
      if (created > 0) {
        const info: LastImportInfo = { importId, fileName, count: created, at: new Date().toISOString(), by: '' };
        await recordLastImport(info).catch(() => {});
        setLastImport(info);
      }
      if (allErrors.length) {
        toast.warning(`Imported ${created} of ${rows.length}. ${allErrors.length} failed — check console.`);
        console.error('Masterlist import errors:', allErrors);
      } else {
        toast.success(`Imported ${created} item(s)!`);
      }
      reset();
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
      setProgress(null);
      setPct(0);
    }
  };

  const doUndo = async () => {
    if (!lastImport) return;
    if (!confirm(`Undo last import?\n\nThis deletes the ${lastImport.count} row(s) added from "${lastImport.fileName}". This cannot be redone.`)) return;
    setUndoing(true);
    try {
      const res = await undoLastImport({ importId: lastImport.importId });
      if (res.success) {
        toast.success(`Removed ${res.deleted} imported row(s).`);
        setLastImport(null);
        onRefresh();
      } else {
        toast.error(res.error || 'Nothing to undo.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Undo failed');
    } finally {
      setUndoing(false);
    }
  };

  const preview = parsed?.rows.slice(0, 8) ?? [];

  return (
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <SheetTrigger asChild>
        <Button size="sm" className="h-7 px-2 text-[10px] sm:text-xs cursor-pointer font-cinzel uppercase tracking-wider">
          <Upload className="h-3 w-3 sm:mr-1" />
          <span className="hidden sm:inline">Upload Masterlist</span>
          <span className="sm:hidden">Upload</span>
        </Button>
      </SheetTrigger>

      <SheetContent side="bottom" className="border-border pb-8 bg-card max-h-[92vh] overflow-y-auto" aria-describedby={undefined}>
        <SheetHeader className="mb-4">
          <SheetTitle className="font-cinzel text-primary">
            {parsed ? 'Preview import' : 'Upload Masterlist'}
          </SheetTitle>
        </SheetHeader>

        {!parsed ? (
          <div className="space-y-4">
            {lastImport && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">Last import</p>
                  <p className="text-xs text-foreground truncate">{lastImport.fileName}</p>
                  <p className="text-[11px] text-muted-foreground">{lastImport.count} row(s) added</p>
                </div>
                <Button variant="outline" size="sm" onClick={doUndo} disabled={undoing} className="shrink-0 h-8 text-xs">
                  {undoing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Undo2 className="h-3.5 w-3.5 mr-1.5" /> Undo</>}
                </Button>
              </div>
            )}
            <div>
              <Label className="text-sm text-muted-foreground mb-2 block">Select Excel / CSV File</Label>
              <div
                className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                {selectedFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    <span className="text-sm text-foreground truncate max-w-[200px]">{selectedFile.name}</span>
                    <button onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}><X className="h-4 w-4 text-muted-foreground" /></button>
                  </div>
                ) : (
                  <div>
                    <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Tap to select file</p>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
            </div>
            <Button onClick={doParse} disabled={parsing || !selectedFile} className="w-full font-cinzel uppercase tracking-widest">
              {parsing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Reading…</> : 'Preview'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="rounded-lg border border-border p-3">
              <p className="text-sm">
                <span className="font-semibold text-primary">{parsed.rows.length}</span> items ready across{' '}
                <span className="font-semibold">{parsed.sheets.length}</span> sheet{parsed.sheets.length !== 1 ? 's' : ''}.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {parsed.sheets.map((s) => (
                  <span key={s.sheetName} className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground flex items-center gap-1">
                    <FileSpreadsheet className="h-3 w-3" /> {s.page || s.sheetName}: {s.rowCount}
                  </span>
                ))}
              </div>
            </div>

            {/* Warnings */}
            {(warnings.noPrice > 0 || warnings.unknownCategories.length > 0 || warnings.unknownSources.length > 0) && (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-1">
                <p className="text-xs font-medium text-warning flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Check before importing</p>
                {warnings.noPrice > 0 && <p className="text-[11px] text-muted-foreground">{warnings.noPrice} row(s) have no price (rate = 0) — they&apos;ll import but priced at 0.</p>}
                {warnings.unknownCategories.length > 0 && <p className="text-[11px] text-muted-foreground">Categories not in your DATA&apos;S list: {warnings.unknownCategories.join(', ')}</p>}
                {warnings.unknownSources.length > 0 && <p className="text-[11px] text-muted-foreground">Sources not in your DATA&apos;S list: {warnings.unknownSources.join(', ')}</p>}
              </div>
            )}

            {/* Sheet format check */}
            {missingCols.length > 0 && (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-2">
                <p className="text-xs font-medium text-warning flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> This customer&apos;s Google Sheet is missing {missingCols.length} column(s)</p>
                <p className="text-[11px] text-muted-foreground">{missingCols.join(', ')}</p>
                <p className="text-[11px] text-muted-foreground">Values for these would be lost. Fix adds them at the end of the Database tab — existing columns and data aren&apos;t touched.</p>
                <Button size="sm" variant="outline" onClick={doFixColumns} disabled={fixingCols} className="h-7 text-xs">
                  {fixingCols ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null} Fix sheet format
                </Button>
              </div>
            )}

            {/* Sample rows */}
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-1.5">Name</th>
                    <th className="text-left px-2 py-1.5">Item</th>
                    <th className="text-left px-2 py-1.5">Cat</th>
                    <th className="text-right px-2 py-1.5">Qty</th>
                    <th className="text-right px-2 py-1.5">Grams</th>
                    <th className="text-right px-2 py-1.5">Gold rate</th>
                    <th className="text-right px-2 py-1.5">MC</th>
                    <th className="text-right px-2 py-1.5">Rate</th>
                    <th className="text-right px-2 py-1.5">Amount</th>
                    <th className="text-left px-2 py-1.5">Cur</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-t border-border/50">
                      <td className="px-2 py-1.5 truncate max-w-[110px]">{r.minerName}</td>
                      <td className="px-2 py-1.5 truncate max-w-[140px]">{r.itemDescription}</td>
                      <td className="px-2 py-1.5 truncate max-w-[90px]">{r.category}</td>
                      <td className="px-2 py-1.5 text-right">{r.qty}</td>
                      <td className="px-2 py-1.5 text-right">{r.grams}</td>
                      <td className="px-2 py-1.5 text-right">{parseFloat(r.goldRate) > 0 ? r.goldRate : '—'}</td>
                      <td className="px-2 py-1.5 text-right">{r.mc || '—'}</td>
                      <td className="px-2 py-1.5 text-right">{r.clientRate}</td>
                      <td className="px-2 py-1.5 text-right">{Math.round((parseFloat(r.grams) || 0) * (parseFloat(r.clientRate) || 0)).toLocaleString()}</td>
                      <td className="px-2 py-1.5">{r.currency || 'AED'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.rows.length > preview.length && (
                <p className="text-[11px] text-muted-foreground px-2 py-1.5 border-t border-border/50">+ {parsed.rows.length - preview.length} more…</p>
              )}
            </div>

            {importing && <ProgressBar value={pct} label={progress || 'Importing…'} className="mb-1" />}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setParsed(null)} disabled={importing} className="flex-1">
                <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
              </Button>
              <Button onClick={doImport} disabled={importing} className="flex-1 font-cinzel uppercase tracking-widest">
                {importing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {progress || 'Importing…'}</> : `Import ${parsed.rows.length}`}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
