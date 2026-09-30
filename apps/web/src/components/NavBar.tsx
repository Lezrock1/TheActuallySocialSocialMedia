import { NavLink } from "react-router-dom";

const primaryLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-base font-semibold ${isActive ? "text-black underline" : "text-gray-700"}`;

const secondaryLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-xs ${isActive ? "text-gray-600 underline" : "text-gray-400"}`;

export default function NavBar() {
  return (
    <nav className="mx-auto mb-3 flex max-w-lg items-baseline justify-between border-b pb-2">
      <div className="flex gap-5">
        <NavLink to="/" end className={primaryLinkClass}>
          Feed
        </NavLink>
        <NavLink to="/snaps" className={primaryLinkClass}>
          Snaps
        </NavLink>
        <NavLink to="/dms" className={primaryLinkClass}>
          Nachrichten
        </NavLink>
      </div>
      <NavLink to="/settings/ai" className={secondaryLinkClass}>
        FactCheck-KI
      </NavLink>
    </nav>
  );
}
