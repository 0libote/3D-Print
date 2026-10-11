/** Keep caller-provided values inside path segments and query parameters. */
export function apiPath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("Invalid API path");
  const [pathname, query = ""] = path.split("?");
  const segments = pathname.slice(1).split("/");
  if (segments.some((segment) => !/^[a-z0-9-]+$/i.test(segment)))
    throw new Error("Invalid API path");
  const parameters = [...new URLSearchParams(query)]
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
  return `/api/${segments.map((segment) => encodeURIComponent(segment)).join("/")}${parameters ? `?${parameters}` : ""}`;
}
