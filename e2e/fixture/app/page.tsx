// A Server Component importing the root entry: it must not drag client code in.
import { DEFAULT_MIN_SCORE } from "recaptcha-next";
import ContactForm from "./contact-form";

export default function Page() {
  return (
    <main>
      <h1>reCAPTCHA fixture</h1>
      <p data-testid="min-score">{DEFAULT_MIN_SCORE}</p>
      <ContactForm />
    </main>
  );
}
