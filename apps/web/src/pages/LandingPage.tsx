import { Link } from "react-router-dom";

import { authClient } from "../auth-client";
import { Logo } from "../components";

const previewBoard = [
  [null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null],
  [null, null, null, "yellow", null, null, null],
  [null, null, "red", "red", null, null, null],
  [null, "yellow", "yellow", "red", null, null, null],
  ["yellow", "red", "red", "yellow", null, null, null],
] as const;

export function LandingPage() {
  const { data: session } = authClient.useSession();
  return (
    <main className="preview-page">
      <header className="preview-nav">
        <Logo />
        <Link className="button button--ghost" to={session ? "/dashboard" : "/sign-in"}>
          {session ? "Your games" : "Sign in"}
        </Link>
      </header>
      <section className="preview-hero">
        <div className="preview-copy">
          <p className="eyebrow">The classic, connected</p>
          <h1>One link. Two players. Four to win.</h1>
          <p className="lede">
            Start a private match, invite a friend, and play live from any phone, tablet, or
            desktop.
          </p>
          <Link className="button button--primary" to={session ? "/dashboard" : "/sign-up"}>
            {session ? "Create a game" : "Play for free"}
          </Link>
          <p className="fine-print">Free account required · No downloads</p>
        </div>
        <div className="game-card" aria-label="Preview of a Four in a Row game board">
          <div className="game-card__status">
            <div>
              <span className="player-dot player-dot--red" />
              <strong>You</strong>
            </div>
            <span className="turn-pill">Your turn · 0:42</span>
            <div>
              <strong>Alex</strong>
              <span className="player-dot player-dot--yellow" />
            </div>
          </div>
          <div className="board-preview">
            {previewBoard.flatMap((row, rowIndex) =>
              row.map((cell, columnIndex) => (
                <span
                  className={`preview-slot${cell ? ` preview-slot--${cell}` : ""}`}
                  key={`${rowIndex}-${columnIndex}`}
                />
              )),
            )}
          </div>
          <p className="game-card__hint">Choose a column to drop your red disc</p>
        </div>
      </section>
    </main>
  );
}
