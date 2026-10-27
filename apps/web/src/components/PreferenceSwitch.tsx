export default function PreferenceSwitch({ label, checked, onChange, tone = "green", disabled = false }: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  tone?: "green" | "magenta";
  disabled?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`preference-switch preference-switch-${tone} disabled:opacity-50`}>
      <span>{label}</span>
      <span aria-hidden="true" className="preference-switch-track"><span className="preference-switch-thumb" /></span>
    </button>
  );
}