export async function GET() {
  return Response.json({
    ok: true,
    service: "commerce-os-ops-center",
    opsCallbackVersion: "server-v1",
  });
}

