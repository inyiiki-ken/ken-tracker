"use client";

import { memo, useState } from 'react';
import { History } from 'lucide-react';
import { DatabaseRowType } from '@/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '@/lib/formatters';
import { toast } from 'sonner';
import { bulkUpdateRecords } from '@/lib/api';
import CustomerHistoryModal from '@/components/CustomerHistoryModal';

interface Props {
  minerName: string;
  records: DatabaseRowType[];
  allRecords: DatabaseRowType[];
  onUpdate: (id: number, fields: Partial<DatabaseRowType>) => Promise<void>;
}

function ReviewChasingCard({ minerName, records, allRecords, onUpdate }: Props) {
  const [showHistory, setShowHistory] = useState(false);
  // Use the first record to dictate display values
  const firstRecord = records[0];
  const status = firstRecord.reviewChasing || 'Pending';
  const isChased = status === 'Chased';

  const handleStatusChange = async (val: string) => {
    try {
      await bulkUpdateRecords({ updates: records.map(r => ({ rowId: r.id, fields: { reviewChasing: val } })) });
      // Also update local state via onUpdate for optimistic UI
      for (const r of records) onUpdate(r.id, { reviewChasing: val });
      toast.success(`Marked ${minerName} as ${val}`);
    } catch {
      toast.error('Failed to update review chasing');
    }
  };

  return (
    <div className={`bg-card border border-border rounded-lg p-4 transition-all duration-500 ease-in-out ${isChased ? 'opacity-50 scale-[0.98] py-2.5' : ''}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className={`font-medium truncate ${isChased ? 'text-xs' : 'text-sm'}`}>
              {minerName || 'Unknown Client'}
            </h3>
            {firstRecord.customerId && (
              <button
                className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                title="View Lifetime History"
                onClick={() => setShowHistory(true)}
              >
                <History className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          
          {/* Hide the item descriptions when chased to save space (auto-minimize) */}
          {!isChased && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {records.map(r => r.itemDescription).join(', ')}
            </p>
          )}
          
          <p className="text-[10px] text-muted-foreground mt-1">
            Delivered: {firstRecord.deliveredDate ? formatDate(firstRecord.deliveredDate) : 'Unknown'}
            {records.length > 1 && ` · ${records.length} items`}
          </p>
        </div>
        
        <div className="flex items-center gap-2 shrink-0">
          <Select
            value={status}
            onValueChange={handleStatusChange}
          >
            <SelectTrigger className={`w-[130px] border-border bg-secondary/30 ${isChased ? 'h-7 text-[10px]' : 'h-8 text-xs'}`}>
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent className="border-border">
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="Chased">Chased</SelectItem>
              <SelectItem value="Skipped">Skipped</SelectItem>
              <SelectItem value="Completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {showHistory && firstRecord.customerId && (
        <CustomerHistoryModal
          customerId={firstRecord.customerId}
          minerName={minerName}
          allRecords={allRecords}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}

// MEMO: Prevent re-rendering unchanged clients for performance
export default memo(ReviewChasingCard, (prev, next) => {
  if (prev.minerName !== next.minerName) return false;
  if (prev.records.length !== next.records.length) return false;
  for (let i = 0; i < prev.records.length; i++) {
    if (prev.records[i] !== next.records[i]) return false;
  }
  if (prev.allRecords !== next.allRecords) return false;
  return true;
});