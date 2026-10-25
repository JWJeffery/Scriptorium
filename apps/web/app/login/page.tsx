import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Scriptorium" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="loginPage">
      <section className="loginCard" aria-labelledby="login-title">
        <p className="eyebrow">Scholarly reading</p>
        <h1 id="login-title">Scriptorium</h1>
        <LoginForm />
      </section>
    </main>
  );
}
