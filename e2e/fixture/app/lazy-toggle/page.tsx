"use client";

import { useState } from "react";
import ContactForm from "../contact-form";

export default function LazyTogglePage() {
  const [lazy, setLazy] = useState(true);
  return (
    <main>
      <button type="button" onClick={() => setLazy(!lazy)}>
        {lazy ? "Load now" : "Enable lazy"}
      </button>
      <div style={{ height: 3000 }}>The form starts outside the viewport</div>
      <ContactForm lazy={lazy} />
    </main>
  );
}
