/**
 * Status label for DM status. Plain text; color carries the state.
 */

const statusConfig: Record<string, { text: string; label: string }> = {
  SENT: { text: "text-success", label: "Gönderildi" },
  FAILED: { text: "text-error", label: "Başarısız" },
  PENDING: { text: "text-warning", label: "Bekliyor" },
  SKIPPED_DEDUP: { text: "text-muted", label: "Yinelenen" },
  SKIPPED_RATE_LIMIT: { text: "text-warning", label: "Limit aşıldı" },
  SKIPPED_PLAN_LIMIT: { text: "text-warning", label: "Atlandı" },
  SKIPPED_NO_MATCH: { text: "text-muted", label: "Eşleşme yok" },
};

interface StatusBadgeProps {
  status: string;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.PENDING;

  return (
    <span className={`shrink-0 whitespace-nowrap text-sm ${config.text}`}>
      {config.label}
    </span>
  );
}
