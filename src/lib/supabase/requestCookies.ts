import { parseCookieHeader } from "@supabase/ssr";

type CookieToSet = {
  name: string;
  value: string;
};

export function createSupabaseRequestCookieStore(request: Request) {
  const requestCookies = new Map(
    parseCookieHeader(request.headers.get("cookie") ?? "").flatMap(
      ({ name, value }) =>
        typeof value === "string" ? [[name, value] as const] : [],
    ),
  );

  return {
    getAll() {
      return Array.from(requestCookies, ([name, value]) => ({
        name,
        value,
      }));
    },
    setAll(cookiesToSet: CookieToSet[]) {
      cookiesToSet.forEach(({ name, value }) => {
        if (value) {
          requestCookies.set(name, value);
        } else {
          requestCookies.delete(name);
        }
      });
    },
  };
}
