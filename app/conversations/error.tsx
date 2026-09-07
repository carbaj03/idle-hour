'use client';
export default function ErrorView({ reset }: { reset: () => void }) {
  return (
    <main className="document">
      <h1>
        The conversation
        <br />
        couldn’t load.
      </h1>
      <p>Unavailable data does not mean the table is empty.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
