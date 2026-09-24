"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, ArrowRightLeft, ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { fmtDate, type LiveSession } from "@/lib/liveSellers";
import { g } from "./parts";

/** An open weigh-out: running total, its movements, and the actions available during the live. */
export default function OpenOutPanel({
  session, compact, onAdd, onGive, onWeighBack, onEdit,
}: {
  session: LiveSession;
  compact?: boolean;
  onAdd: () => void;
  onGive: () => void;
  onWeighBack: () => void;
  onEdit?: () => void;
}) {
  const [showLog, setShowLog] = useState(false);
  const moves = session.outLog.length;
  const time = (iso: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
  return (
    <div className={`rounded-lg border border-info/40 bg-info/10 ${compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto">
          <b>{g(session.weightOut)}</b> out since {fmtDate(session.date)}
          {moves > 1 && (
            <button onClick={() => setShowLog((v) => !v)} className="ml-1 underline text-muted-foreground">
              {moves} moves {showLog ? <ChevronUp className="inline h-3 w-3" /> : <ChevronDown className="inline h-3 w-3" />}
            </button>
          )}
        </span>
        {onEdit && (
          <Button size="sm" variant="ghost" className={compact ? "h-7 px-1.5" : ""} onClick={onEdit} title="Fix a wrong entry">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button size="sm" variant="outline" className={compact ? "h-7 px-2" : ""} onClick={onAdd} title="More pieces taken from the room">
          <Plus className="h-3.5 w-3.5 mr-1" /> Add more
        </Button>
        <Button size="sm" variant="outline" className={compact ? "h-7 px-2" : ""} onClick={onGive} title="Lend to another seller">
          <ArrowRightLeft className="h-3.5 w-3.5 mr-1" /> Give
        </Button>
        <Button size="sm" className={compact ? "h-7 px-2" : ""} onClick={onWeighBack}>Weigh back</Button>
      </div>
      {showLog && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {session.outLog.map((e, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-16 text-muted-foreground">{time(e.at)}</span>
              <span className={`w-20 tabular-nums font-medium ${e.grams < 0 ? "text-destructive" : "text-success"}`}>{e.grams > 0 ? "+" : ""}{g(e.grams)}</span>
              <span className="text-muted-foreground">{e.note}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
