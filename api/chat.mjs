const SUPABASE_URL = 'https://uufitabbezjdeaxirjbj.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_aqP_JjBuPZDXfWpYkfyG0Q_Zs6alZH7';

const json = (value, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request) {
  if (!process.env.GEMINI_API_KEY)
    return json({ error: 'Gemini API кілті Vercel-де орнатылмаған.' }, 503);

  const bearer = request.headers.get('authorization') || '';
  if (!/^Bearer [A-Za-z0-9._~-]+$/.test(bearer))
    return json({ error: 'Алдымен жүйеге кіріңіз.' }, 401);

  let message;
  try {
    const body = await request.json();
    message = typeof body.message === 'string' ? body.message.trim() : '';
  } catch {
    return json({ error: 'Сұрау форматы қате.' }, 400);
  }
  if (!message || message.length > 2000)
    return json({ error: 'Сұрақ 1–2000 таңба болуы керек.' }, 400);

  try {
    const headers = { apikey: PUBLISHABLE_KEY, Authorization: bearer };
    const auth = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers,
      signal: AbortSignal.timeout(10000)
    });
    if (!auth.ok)
      return json({ error: 'Кіру сессиясы аяқталды. Қайта кіріңіз.' }, 401);

    const account = await auth.json();
    if (!account.id)
      return json({ error: 'Кіру сессиясы жарамсыз.' }, 401);

    const profile = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(account.id)}&select=status,role`,
      { headers, signal: AbortSignal.timeout(10000) }
    );
    if (!profile.ok)
      return json({ error: 'Қызметкер рөлін тексеру мүмкін болмады.' }, 403);

    const [employee] = await profile.json();
    if (employee?.status !== 'approved' || !employee.role)
      return json({ error: 'AI тек расталған қызметкерлерге қолжетімді.' }, 403);

    const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    const gemini = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: 'You assist employees of Kuryk Port. Reply in the language of the question. Give practical, concise guidance. Do not claim access to live port data. Say when a fact needs verification.'
            }]
          },
          contents: [{ role: 'user', parts: [{ text: message }] }],
          generationConfig: { maxOutputTokens: 800 }
        }),
        signal: AbortSignal.timeout(25000)
      }
    );

    if (!gemini.ok)
      return json({
        error: `Gemini жауап бермеді (HTTP ${gemini.status}). API кілтін және модельді тексеріңіз.`
      }, 502);

    const result = await gemini.json();
    const answer = result.candidates?.[0]?.content?.parts
      ?.map(p => p.text || '').join('').trim();

    if (!answer)
      return json({ error: 'Gemini бос жауап қайтарды. Сұрақты өзгертіп көріңіз.' }, 502);

    return json({ answer });
  } catch {
    return json({ error: 'AI серверімен байланыс үзілді. Кейін қайта көріңіз.' }, 502);
  }
}
