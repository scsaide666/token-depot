import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiKeyDate, apiKeyLastUsed, maskedApiKey, type ApiKeyRecord } from "@/lib/api-key-types";
import { KeyActions, type KeyAction } from "./key-actions";

export function KeysTable({ records, onCopy, onAction }: {
  records: ApiKeyRecord[]; onCopy: (record: ApiKeyRecord) => void;
  onAction: (action: KeyAction, record: ApiKeyRecord, trigger: HTMLButtonElement | null) => void;
}) {
  return <section className="console-panel" aria-label="API key management">
    <Table className="console-keys-table text-[13px]" containerProps={{ role: "region", "aria-label": "API keys, scroll horizontally for more columns", tabIndex: 0 }}>
      <caption className="sr-only">Your API keys. Full keys are never included. Dates are UTC.</caption>
      <TableHeader><TableRow><TableHead>Name</TableHead><TableHead className="hidden md:table-cell">Key</TableHead><TableHead className="hidden md:table-cell">Created (UTC)</TableHead><TableHead className="hidden md:table-cell">Last Used</TableHead><TableHead className="console-key-status">Status</TableHead><TableHead className="console-key-actions text-right">Actions</TableHead></TableRow></TableHeader>
      <TableBody>{records.map(record => <TableRow key={record.id}>
        <TableCell className="max-w-[220px] whitespace-normal font-medium [overflow-wrap:anywhere]">{record.name}<div className="mt-1.5 min-w-0 font-normal md:hidden"><code className="console-key-mask block truncate font-mono text-[11px] text-muted-foreground" title={maskedApiKey(record)}>{maskedApiKey(record)}</code><p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Created {apiKeyDate(record.createdAt)} UTC<br />Last used {apiKeyLastUsed(record.lastUsedAt)}</p></div></TableCell>
        <TableCell className="hidden md:table-cell"><code className="console-key-mask block max-w-[200px] truncate font-mono text-xs text-muted-foreground" title={maskedApiKey(record)}>{maskedApiKey(record)}</code></TableCell>
        <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">{apiKeyDate(record.createdAt)}</TableCell>
        <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">{apiKeyLastUsed(record.lastUsedAt)}</TableCell>
        <TableCell className="console-key-status"><Badge variant="secondary" data-api-status={record.status} className={record.status === "active" ? "text-foreground" : "text-muted-foreground"}>{record.status === "active" ? "Active" : record.status === "revoked" ? "Revoked" : "Expired"}</Badge></TableCell>
        <TableCell className="console-key-actions text-right"><KeyActions record={record} onCopy={onCopy} onAction={onAction} /></TableCell>
      </TableRow>)}</TableBody>
    </Table><footer className="console-table-footer"><span>{records.length} {records.length === 1 ? "key" : "keys"}</span><span>Only masked keys can be copied from this list.</span></footer>
  </section>;
}
