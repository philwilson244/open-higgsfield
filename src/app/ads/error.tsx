"use client";
import Link from "next/link";
export default function AdsError({ reset }: { reset: () => void }) {
  return (
    <main className="ads-shell">
      <h1>Your workspace is unavailable</h1>
      <p>
        Your saved work hasn’t been changed. Check the connection and database
        migration, then try again.
      </p>
      <button onClick={reset}>Try again</button>{" "}
      <Link href="/">Return to generation studio</Link>
    </main>
  );
}
