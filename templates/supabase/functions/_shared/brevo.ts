const BREVO_API_URL = "https://api.brevo.com/v3";

function getBrevoApiKey() {
  return Deno.env.get("BREVO_API_KEY")?.trim() || "";
}

export async function sendBrevoBookingEmail({
  toEmail,
  toName,
  subject,
  htmlContent,
}: {
  toEmail: string;
  toName: string;
  subject: string;
  htmlContent: string;
}) {
  const apiKey = getBrevoApiKey();
  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL")?.trim() || "";
  const senderName = Deno.env.get("BREVO_SENDER_NAME")?.trim() || "{{brand.name}}";

  if (!apiKey || !senderEmail) {
    return { skipped: true };
  }

  const res = await fetch(`${BREVO_API_URL}/smtp/email`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: senderEmail,
        name: senderName,
      },
      to: [{ email: toEmail, name: toName }],
      subject,
      htmlContent,
    }),
  });

  if (!res.ok) {
    throw new Error(`BREVO_SEND_FAILED: ${await res.text()}`);
  }

  return { skipped: false };
}

export async function upsertBrevoNewsletterContact({
  email,
  name,
  extraAttributes,
  addToNewsletterList = true,
}: {
  email: string;
  name: string;
  extraAttributes?: Record<string, string | number | boolean>;
  addToNewsletterList?: boolean;
}) {
  const apiKey = getBrevoApiKey();
  const listId = Deno.env.get("BREVO_NEWSLETTER_LIST_ID")?.trim() || "";

  if (!apiKey) {
    return { skipped: true };
  }
  if (addToNewsletterList && !listId) {
    return { skipped: true };
  }

  const [firstName, ...rest] = name.trim().split(/\s+/);
  const lastName = rest.join(" ");

  const attributes: Record<string, unknown> = {
    FIRSTNAME: firstName || undefined,
    LASTNAME: lastName || undefined,
    ...(extraAttributes || {}),
  };

  const body: Record<string, unknown> = {
    email,
    updateEnabled: true,
    attributes,
  };
  if (addToNewsletterList) {
    body.listIds = [Number(listId)];
  }

  const createRes = await fetch(`${BREVO_API_URL}/contacts`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (createRes.ok || createRes.status === 204) {
    return { skipped: false };
  }

  throw new Error(`BREVO_CONTACT_SYNC_FAILED: ${await createRes.text()}`);
}

export async function sendBrevoTemplateEmail({
  toEmail,
  toName,
  templateId,
  params,
}: {
  toEmail: string;
  toName?: string;
  templateId: number;
  params?: Record<string, unknown>;
}) {
  const apiKey = getBrevoApiKey();
  if (!apiKey) return { skipped: true };

  const body: Record<string, unknown> = {
    templateId,
    to: [{ email: toEmail, name: toName || toEmail }],
  };
  if (params && Object.keys(params).length > 0) {
    body.params = params;
  }

  const res = await fetch(`${BREVO_API_URL}/smtp/email`, {
    method: "POST",
    headers: { accept: "application/json", "api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`BREVO_TEMPLATE_SEND_FAILED: ${res.status} ${await res.text()}`);
  return { skipped: false };
}

export async function ensureBrevoAttribute(
  name: string,
  type: "boolean" | "float" | "text" | "date" = "boolean",
) {
  const apiKey = getBrevoApiKey();
  if (!apiKey) return { skipped: true };
  const res = await fetch(`${BREVO_API_URL}/contacts/attributes/normal/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { accept: "application/json", "api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ type }),
  });
  // 201 = created, 400 with "already exists" = idempotent OK
  if (res.ok || res.status === 204) return { created: true };
  const body = await res.text();
  if (body.includes("already exist") || res.status === 400) return { created: false };
  throw new Error(`BREVO_ATTR_CREATE_FAILED: ${res.status} ${body}`);
}

