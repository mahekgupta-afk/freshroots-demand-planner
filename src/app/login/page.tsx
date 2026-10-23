import { LoginForm } from "./form";

export default function LoginPage() {
  return (
    <div className="mx-auto mt-16 max-w-sm rounded-lg border border-slate-200 bg-white p-6">
      <h1 className="mb-1 text-xl font-semibold">Sign in</h1>
      <p className="mb-5 text-sm text-slate-600">Freshroots Demand Planner</p>
      <LoginForm />
    </div>
  );
}
