import { readFile } from "node:fs/promises";
import nodemailer from "nodemailer";

import type { AppConfig } from "./config";
import type { AppLogger } from "./logger";

interface RecipientEmail {
  to: string;
  username: string;
}

export type EmailMessage =
  | (RecipientEmail & {
      kind: "verification";
      verificationUrl: string;
    })
  | (RecipientEmail & {
      kind: "password-reset";
      resetUrl: string;
    })
  | (RecipientEmail & {
      kind: "friend-request";
      requesterUsername: string;
      friendsUrl: string;
    });

type EmailKind = EmailMessage["kind"];
type TemplateModel = Record<string, string | number>;

interface LocalEmailTemplate {
  subject: string;
  text: string;
  html: string;
}

export interface RenderedEmail extends LocalEmailTemplate {
  templateModel: TemplateModel;
}

const templateCache = new Map<EmailKind, Promise<LocalEmailTemplate>>();
const placeholderPattern = /{{\s*([a-z0-9_]+)\s*}}/gi;

function loadLocalTemplate(kind: EmailKind) {
  const cached = templateCache.get(kind);
  if (cached) return cached;

  const template = Promise.all([
    readFile(new URL(`../email-templates/${kind}/subject.txt`, import.meta.url), "utf8"),
    readFile(new URL(`../email-templates/${kind}/text.txt`, import.meta.url), "utf8"),
    readFile(new URL(`../email-templates/${kind}/html.html`, import.meta.url), "utf8"),
  ]).then(([subject, text, html]) => ({ subject, text, html }));
  templateCache.set(kind, template);
  return template;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

export function renderTemplate(source: string, model: TemplateModel, html = false) {
  return source.replace(placeholderPattern, (_placeholder, key: string) => {
    if (!(key in model)) throw new Error(`Missing email template value: ${key}`);
    const value = String(model[key]);
    return html ? escapeHtml(value) : value;
  });
}

function emailModel(message: EmailMessage, config: AppConfig): TemplateModel {
  const commonModel = {
    product_name: "Four in a Row",
    username: message.username,
    support_email: config.smtp.replyTo,
    current_year: new Date().getUTCFullYear(),
  };

  switch (message.kind) {
    case "verification":
      return {
        ...commonModel,
        verification_url: message.verificationUrl,
        expires_in: "1 hour",
      };
    case "password-reset":
      return { ...commonModel, reset_url: message.resetUrl, expires_in: "1 hour" };
    case "friend-request":
      return {
        ...commonModel,
        requester_username: message.requesterUsername,
        friends_url: message.friendsUrl,
      };
  }
}

export async function renderEmail(
  message: EmailMessage,
  config: AppConfig,
): Promise<RenderedEmail> {
  const template = await loadLocalTemplate(message.kind);
  const templateModel = emailModel(message, config);
  return {
    subject: renderTemplate(template.subject, templateModel).trim(),
    text: renderTemplate(template.text, templateModel).trim(),
    html: renderTemplate(template.html, templateModel, true).trim(),
    templateModel,
  };
}

export function createEmailSender(config: AppConfig, logger: AppLogger) {
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    requireTLS: config.smtp.requireTls,
    auth:
      config.smtp.user && config.smtp.password
        ? { user: config.smtp.user, pass: config.smtp.password }
        : undefined,
  });

  return async (message: EmailMessage) => {
    try {
      const rendered = await renderEmail(message, config);
      await transport.sendMail({
        from: config.smtp.from,
        to: message.to,
        replyTo: config.smtp.replyTo,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
    } catch (error) {
      logger.error({ err: error, emailKind: message.kind }, "Unable to send email");
    }
  };
}
