import { describe, expect, it } from "vitest";

import { loadConfig } from "./config";
import { renderEmail, renderTemplate } from "./email";

const config = loadConfig({
  BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
  EMAIL_REPLY_TO: "play@yadayada.co.uk",
});

describe("local SMTP email templates", () => {
  it("renders the verification HTML, text, subject, and documented model", async () => {
    const rendered = await renderEmail(
      {
        kind: "verification",
        to: "player@example.test",
        username: "ExamplePlayer",
        verificationUrl: "https://connect.yadayada.co.uk/verify/example",
      },
      config,
    );

    expect(rendered.subject).toBe("Verify your Four in a Row account");
    expect(rendered.text).toContain("Hi ExamplePlayer,");
    expect(rendered.html).toContain("One move left,");
    expect(rendered.html).toContain("https://connect.yadayada.co.uk/verify/example");
    expect(rendered.html).not.toMatch(/{{[^}]+}}/);
    expect(rendered.templateModel).toEqual({
      product_name: "Four in a Row",
      username: "ExamplePlayer",
      verification_url: "https://connect.yadayada.co.uk/verify/example",
      expires_in: "1 hour",
      support_email: "play@yadayada.co.uk",
      current_year: new Date().getUTCFullYear(),
    });
  });

  it("renders the password-reset HTML, text, subject, and documented model", async () => {
    const rendered = await renderEmail(
      {
        kind: "password-reset",
        to: "player@example.test",
        username: "ExamplePlayer",
        resetUrl: "https://connect.yadayada.co.uk/reset/example",
      },
      config,
    );

    expect(rendered.subject).toBe("Reset your Four in a Row password");
    expect(rendered.text).toContain("Hi ExamplePlayer,");
    expect(rendered.html).toContain("Get back in the game,");
    expect(rendered.html).toContain("https://connect.yadayada.co.uk/reset/example");
    expect(rendered.html).not.toMatch(/{{[^}]+}}/);
    expect(rendered.templateModel).toEqual({
      product_name: "Four in a Row",
      username: "ExamplePlayer",
      reset_url: "https://connect.yadayada.co.uk/reset/example",
      expires_in: "1 hour",
      support_email: "play@yadayada.co.uk",
      current_year: new Date().getUTCFullYear(),
    });
  });

  it("renders the friend-request email with the sender and dashboard link", async () => {
    const rendered = await renderEmail(
      {
        kind: "friend-request",
        to: "player@example.test",
        username: "ExamplePlayer",
        requesterUsername: "FriendlyRival",
        friendsUrl: "https://connect.yadayada.co.uk/friends",
      },
      config,
    );

    expect(rendered.subject).toBe("FriendlyRival sent you a friend request");
    expect(rendered.text).toContain("Hi ExamplePlayer,");
    expect(rendered.text).toContain("FriendlyRival sent you a friend request");
    expect(rendered.html).toContain("FriendlyRival");
    expect(rendered.html).toContain("https://connect.yadayada.co.uk/friends");
    expect(rendered.html).not.toMatch(/{{[^}]+}}/);
    expect(rendered.templateModel).toEqual({
      product_name: "Four in a Row",
      username: "ExamplePlayer",
      requester_username: "FriendlyRival",
      friends_url: "https://connect.yadayada.co.uk/friends",
      support_email: "play@yadayada.co.uk",
      current_year: new Date().getUTCFullYear(),
    });
  });

  it("escapes personalized values in HTML templates", () => {
    expect(renderTemplate("<p>{{username}}</p>", { username: "A&B <Player>" }, true)).toBe(
      "<p>A&amp;B &lt;Player&gt;</p>",
    );
  });

  it("rejects missing template values", () => {
    expect(() => renderTemplate("Hello {{username}}", {})).toThrow(
      "Missing email template value: username",
    );
  });
});
