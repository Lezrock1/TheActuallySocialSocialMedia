import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";

export default function PageHeader({ title }: { title: string }) {
  const { user, logout } = useAuth();
  return (
    <header className="mb-2 flex items-center justify-between">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="flex items-center gap-3 text-sm">
        <Link to={`/u/${user?.username}`} className="underline">
          @{user?.username}
        </Link>
        <button onClick={() => logout()} className="underline">
          Abmelden
        </button>
      </div>
    </header>
  );
}
