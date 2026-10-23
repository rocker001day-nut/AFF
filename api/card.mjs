const UPSTREAM = 'https://txbsrtunejnqaheuohck.supabase.co/functions/v1/facebook-publisher';

export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return new Response('ไม่พบการ์ด', { status: 404 });
  }

  try {
    const upstream = await fetch(UPSTREAM + '?action=card&id=' + encodeURIComponent(id));
    if (!upstream.ok) return new Response('ไม่พบการ์ด', { status: upstream.status === 404 ? 404 : 502 });
    const html = await upstream.text();
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch {
    return new Response('การ์ดยังเปิดไม่ได้ กรุณาลองอีกครั้ง', { status: 502 });
  }
}
