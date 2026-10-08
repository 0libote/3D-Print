import { RequestError } from "./production";

export function positiveNumber(value: unknown, label: string, max = 1_000_000) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0 || number > max)
    throw new RequestError(`${label} must be between 0 and ${max}`);
  return number;
}
export function productionDetails(body: Record<string, unknown>) {
  const url = String(body.production_url ?? "").trim();
  if (url && (!/^https?:\/\//.test(url) || url.length > 1000))
    throw new RequestError("Use an HTTP or HTTPS link to the production file");
  const revision = String(body.revision ?? "").trim(),
    profile = String(body.print_profile ?? "").trim();
  if (revision.length > 100 || profile.length > 2000)
    throw new RequestError("Production details are too long");
  return {
    grams: positiveNumber(body.grams_per_piece, "Grams per piece", 100000),
    minutes: positiveNumber(
      body.minutes_per_piece,
      "Minutes per piece",
      100000,
    ),
    url,
    revision,
    profile,
  };
}
export function validatePushSubscription(value: unknown) {
  if (!value || typeof value !== "object")
    throw new RequestError("Invalid push subscription");
  const subscription = value as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  let endpoint: URL;
  try {
    endpoint = new URL(String(subscription.endpoint));
  } catch {
    throw new RequestError("Invalid push endpoint");
  }
  // Only established Web Push services are accepted, preventing arbitrary server requests.
  const allowed = [
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
    "web.push.apple.com",
    "notify.windows.com",
    "push.services.mozilla.com",
  ];
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    String(subscription.endpoint).length > 2048 ||
    !allowed.some(
      (host) =>
        endpoint.hostname === host || endpoint.hostname.endsWith("." + host),
    )
  )
    throw new RequestError("Unsupported push service");
  const validKey = (key: unknown, size: number) =>
    typeof key === "string" &&
    /^[A-Za-z0-9_-]+$/.test(key) &&
    Buffer.from(key, "base64url").length === size;
  if (
    !validKey(subscription.keys?.p256dh, 65) ||
    !validKey(subscription.keys?.auth, 16)
  )
    throw new RequestError("Invalid push keys");
}
export async function imageExtension(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (
    file.type === "image/png" &&
    Buffer.from(bytes.slice(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  )
    return ".png";
  if (
    file.type === "image/jpeg" &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return ".jpg";
  if (
    file.type === "image/webp" &&
    Buffer.from(bytes.slice(0, 4)).toString() === "RIFF" &&
    Buffer.from(bytes.slice(8, 12)).toString() === "WEBP"
  )
    return ".webp";
  throw new RequestError(
    "The file content does not match a supported image format",
  );
}
