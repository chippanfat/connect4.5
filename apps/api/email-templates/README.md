# Local account email templates

The API renders these files locally and sends the resulting HTML and plain-text
parts through the configured SMTP server. No Postmark-hosted templates or
template IDs are used.

Each email has three files:

- `subject.txt` — message subject.
- `html.html` — responsive branded HTML body.
- `text.txt` — accessible plain-text fallback.

The renderer HTML-escapes personalised values before inserting them into the
HTML body. Subject and text values are inserted as plain text. An unrecognised
or missing placeholder causes the email to be rejected and logged rather than
sending a broken message.

## Verification template model

```json
{
  "product_name": "Four in a Row",
  "username": "ExamplePlayer",
  "verification_url": "https://connect.yadayada.co.uk/api/auth/verify-email?token=example",
  "expires_in": "1 hour",
  "support_email": "play@yadayada.co.uk",
  "current_year": 2026
}
```

## Password-reset template model

```json
{
  "product_name": "Four in a Row",
  "username": "ExamplePlayer",
  "reset_url": "https://connect.yadayada.co.uk/reset-password/example",
  "expires_in": "1 hour",
  "support_email": "play@yadayada.co.uk",
  "current_year": 2026
}
```

Keep placeholder names aligned with the model built in `apps/api/src/email.ts`.
The template files are loaded lazily and cached for the lifetime of the API
process, so restart the API after changing a template in production.
