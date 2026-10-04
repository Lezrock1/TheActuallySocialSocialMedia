export default function EncryptionNotice({
  encrypted,
  children,
}: {
  encrypted: boolean;
  children?: string;
}) {
  return (
    encrypted ? (
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-green-700">
        <span aria-hidden="true" className="font-bold text-green-600">✓</span>
        End-to-end encrypted
      </p>
    ) : (
      <p className="flex items-center gap-1.5 text-[11px] text-red-600">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" />
        {children ?? "Not end-to-end encrypted"}
      </p>
    )
  );
}