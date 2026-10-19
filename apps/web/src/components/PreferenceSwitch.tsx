export default function PreferenceSwitch({ label, checked, onChange, tone = "green" }: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  tone?: "green" | "magenta";
}) {
  return (
    <button type="button" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)} className={`preference-switch preference-switch-${tone}`}>
      <span>{label}</span>
      <span aria-hidden="true" className="preference-switch-track"><span className="preference-switch-thumb" /></span>
    </button>
  );
}