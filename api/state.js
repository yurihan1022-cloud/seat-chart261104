// Vercel Serverless Function: /api/state
// 저장소: Upstash Redis (REST API를 fetch로 직접 호출 - 별도 패키지 설치 불필요)
// 하나의 해시(seat-chart:v1)에 모든 데이터를 저장합니다.
//   s:<좌석ID>  -> 학번 문자열
//   c:<학년반>  -> JSON {enrolled, absences:[{id,reason}]}
//   notes       -> 전달사항 문자열

const KEY = 'seat-chart:v1';

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const SEAT_RE = /^(AL|AC|AR)\d{1,2}_(W\d|\d{1,2})$/;
const CLASS_RE = /^g[1-3]c[1-9]$/;

const str = (v, max) => String(v == null ? '' : v).slice(0, max);

async function redis(args) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'redis http ' + r.status);
  return j.result;
}

function cleanClass(c) {
  const enrolled = str(c && c.enrolled, 5).trim();
  const absences = (c && Array.isArray(c.absences) ? c.absences : [])
    .slice(0, 60)
    .map(a => ({ id: str(a && a.id, 10).trim(), reason: str(a && a.reason, 100) }));
  return { enrolled, absences };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ code: 'no_storage', detail: 'Redis 환경변수가 없습니다.' });
  }

  try {
    if (req.method === 'GET') {
      const flat = (await redis(['HGETALL', KEY])) || [];
      const seats = {};
      const classes = {};
      let notes = '';
      for (let i = 0; i + 1 < flat.length; i += 2) {
        const field = String(flat[i]);
        const raw = flat[i + 1];
        if (field.startsWith('s:')) {
          seats[field.slice(2)] = String(raw);
        } else if (field.startsWith('c:')) {
          try { classes[field.slice(2)] = JSON.parse(raw); } catch (e) { /* 깨진 값은 무시 */ }
        } else if (field === 'notes') {
          notes = String(raw);
        }
      }
      return res.status(200).json({ ok: true, seats, classes, notes });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = null; }
      }
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ code: 'bad_request' });
      }

      switch (body.op) {
        case 'seat': {
          const id = str(body.id, 20);
          if (!SEAT_RE.test(id)) return res.status(400).json({ code: 'bad_id' });
          const v = str(body.v, 6).trim();
          if (v) await redis(['HSET', KEY, 's:' + id, v]);
          else await redis(['HDEL', KEY, 's:' + id]);
          return res.status(200).json({ ok: true });
        }

        case 'class': {
          const key = str(body.key, 10);
          if (!CLASS_RE.test(key)) return res.status(400).json({ code: 'bad_key' });
          const c = cleanClass(body);
          if (!c.enrolled && c.absences.length === 0) await redis(['HDEL', KEY, 'c:' + key]);
          else await redis(['HSET', KEY, 'c:' + key, JSON.stringify(c)]);
          return res.status(200).json({ ok: true });
        }

        case 'notes': {
          const text = str(body.text, 5000);
          if (text) await redis(['HSET', KEY, 'notes', text]);
          else await redis(['HDEL', KEY, 'notes']);
          return res.status(200).json({ ok: true });
        }

        // 저장 버튼: 한 번에 여러 칸 저장
        case 'bulk': {
          const sets = [];
          const dels = [];
          const seats = body.seats && typeof body.seats === 'object' ? body.seats : {};
          Object.keys(seats).slice(0, 500).forEach(id => {
            const v = str(seats[id], 6).trim();
            if (SEAT_RE.test(id) && v) sets.push('s:' + id, v);
          });
          (Array.isArray(body.del) ? body.del : []).slice(0, 500).forEach(id => {
            if (SEAT_RE.test(String(id))) dels.push('s:' + id);
          });
          const classes = body.classes && typeof body.classes === 'object' ? body.classes : {};
          Object.keys(classes).slice(0, 30).forEach(key => {
            if (!CLASS_RE.test(key)) return;
            const c = cleanClass(classes[key]);
            if (!c.enrolled && c.absences.length === 0) dels.push('c:' + key);
            else sets.push('c:' + key, JSON.stringify(c));
          });
          if (typeof body.notes === 'string') {
            const t = str(body.notes, 5000);
            if (t) sets.push('notes', t);
            else dels.push('notes');
          }
          if (sets.length) await redis(['HSET', KEY, ...sets]);
          if (dels.length) await redis(['HDEL', KEY, ...dels]);
          return res.status(200).json({ ok: true });
        }

        case 'clear': {
          await redis(['DEL', KEY]);
          return res.status(200).json({ ok: true });
        }

        default:
          return res.status(400).json({ code: 'bad_op' });
      }
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ code: 'method_not_allowed' });
  } catch (e) {
    console.error(e);
    const msg = String((e && e.message) || '');
    const limited = /429|rate|limit|quota|max/i.test(msg);
    return res.status(limited ? 429 : 500).json({ code: limited ? 'rate_limited' : 'server_error', detail: msg.slice(0, 200) });
  }
};
