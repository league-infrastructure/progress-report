import sgMail from '@sendgrid/mail';

// Only configure SendGrid when a real key is present. The SDK throws on an
// empty or malformed key, and this module is imported at startup (and in tests)
// regardless of whether email is configured — e.g. in dev/CI without a key, or
// on deployments where only Pike13 notes are used. Send functions below already
// no-op when the key is missing, so guarding the import keeps them safe.
const sendgridKey = process.env.SENDGRID_API_KEY ?? '';
if (sendgridKey.startsWith('SG.')) {
  sgMail.setApiKey(sendgridKey);
}

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';

const SURVEY_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSeBj4wargR6PVK2-c4NtoBwNFcg1Dc6FT_DXKhgae5lDAE54g/viewform';

function buildEmailHtml(params: {
  studentName: string;
  month: string;
  reviewBody: string;
  feedbackUrl: string;
}): string {
  const { studentName, month, reviewBody, feedbackUrl } = params;
  const bodyLines = reviewBody
    .split('\n')
    .map((line) => `<p style="margin:0 0 12px 0;color:#374151;font-size:15px;line-height:1.6;">${line || '&nbsp;'}</p>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Progress Report</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background-color:#f37121;padding:28px 32px;text-align:center;">
              <img
                src="https://www.jointheleague.org/_astro/wordmark-h-1200.DPj-wZBK_Z2jTnVL.webp"
                alt="The LEAGUE of Amazing Programmers"
                width="260"
                style="display:block;margin:0 auto;max-width:260px;"
              />
            </td>
          </tr>

          <!-- Title bar -->
          <tr>
            <td style="background-color:#1e293b;padding:16px 32px;">
              <p style="margin:0;color:#ffffff;font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">
                Monthly Progress Report
              </p>
              <p style="margin:4px 0 0 0;color:#f37121;font-size:20px;font-weight:700;">
                ${studentName} &mdash; ${month}
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${bodyLines}
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <!-- Feedback CTA -->
          <tr>
            <td style="padding:28px 32px;text-align:center;background-color:#fafafa;">
              <p style="margin:0 0 6px 0;font-size:16px;font-weight:700;color:#1e293b;">
                How are we doing?
              </p>
              <p style="margin:0 0 20px 0;font-size:14px;color:#6b7280;">
                We'd love to hear your feedback on ${studentName}'s experience with LEAGUE.
              </p>
              <a
                href="${feedbackUrl}"
                style="display:inline-block;background-color:#f37121;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px;letter-spacing:0.02em;"
              >
                ⭐ Leave Feedback (1–5 Stars)
              </a>
              <p style="margin:16px 0 0 0;font-size:12px;color:#9ca3af;">
                Or copy this link: <a href="${feedbackUrl}" style="color:#f37121;">${feedbackUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Survey CTA -->
          <tr>
            <td style="padding:0 32px 28px 32px;text-align:center;background-color:#fafafa;">
              <p style="margin:0 0 6px 0;font-size:15px;font-weight:700;color:#1e293b;">
                Parent Satisfaction Survey
              </p>
              <p style="margin:0 0 16px 0;font-size:14px;color:#6b7280;">
                Help us improve — share your thoughts in our short parent survey.
              </p>
              <a
                href="${SURVEY_URL}"
                style="display:inline-block;background-color:#1e293b;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px;letter-spacing:0.02em;"
              >
                Take the Survey
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background-color:#1e293b;text-align:center;">
              <p style="margin:0;font-size:12px;color:#94a3b8;">
                &copy; ${new Date().getFullYear()} The LEAGUE of Amazing Programmers &bull;
                <a href="https://www.jointheleague.org" style="color:#f37121;text-decoration:none;">jointheleague.org</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Placement assessment result email
// ---------------------------------------------------------------------------

interface PlacementBandScore {
  label: string;
  correct: number;
  total: number;
  pct: number;
  mastered: boolean;
}

interface PlacementEmailResult {
  score: number;
  correctCount: number;
  total: number;
  masteryPct: number;
  bandScores: PlacementBandScore[];
  recommended: { level: string; lesson: string; label: string; note?: string };
}

const PLACEMENT_LEVEL_NAMES: Record<string, string> = {
  'python-apprentice': 'Python Apprentice',
  'python-games': 'Python Games',
};

function prettyPlacementLesson(lesson: string): string {
  if (!lesson || lesson === 'complete') return '';
  return lesson.replace(/^lessons\//, '');
}

function buildPlacementHtml(params: { takerName: string; result: PlacementEmailResult }): string {
  const { takerName, result } = params;
  const levelName = PLACEMENT_LEVEL_NAMES[result.recommended.level] ?? result.recommended.level;
  const lesson = prettyPlacementLesson(result.recommended.lesson);
  const startLine = lesson ? `${levelName} &middot; ${lesson}` : levelName;

  const rows = result.bandScores
    .map(
      (b) => `<tr>
        <td style="padding:8px 12px;color:#374151;font-size:14px;border-top:1px solid #e5e7eb;">${b.label}</td>
        <td style="padding:8px 12px;color:#6b7280;font-size:14px;border-top:1px solid #e5e7eb;">${b.correct}/${b.total}</td>
        <td style="padding:8px 12px;font-size:14px;border-top:1px solid #e5e7eb;color:${b.mastered ? '#15803d' : '#b45309'};">${b.pct}%${b.mastered ? ' &#10003;' : ''}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Placement Result</title></head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background-color:#f37121;padding:28px 32px;text-align:center;">
          <img src="https://www.jointheleague.org/_astro/wordmark-h-1200.DPj-wZBK_Z2jTnVL.webp" alt="The LEAGUE of Amazing Programmers" width="260" style="display:block;margin:0 auto;max-width:260px;" />
        </td></tr>
        <tr><td style="background-color:#1e293b;padding:16px 32px;">
          <p style="margin:0;color:#ffffff;font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Python Placement Result</p>
          <p style="margin:4px 0 0 0;color:#f37121;font-size:20px;font-weight:700;">${takerName}</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <div style="background-color:#eff6ff;border-radius:8px;padding:20px;margin-bottom:24px;">
            <p style="margin:0;color:#6b7280;font-size:13px;">Recommended starting point</p>
            <p style="margin:4px 0 0 0;color:#1e40af;font-size:20px;font-weight:700;">${startLine}</p>
            ${result.recommended.note ? `<p style="margin:8px 0 0 0;color:#374151;font-size:14px;">${result.recommended.note}</p>` : ''}
            <p style="margin:10px 0 0 0;color:#374151;font-size:14px;">Overall score: <strong>${result.score}%</strong> (${result.correctCount}/${result.total})</p>
          </div>
          <p style="margin:0 0 8px 0;color:#1e293b;font-size:15px;font-weight:700;">How you did by topic</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;overflow:hidden;">
            <tbody>${rows}</tbody>
          </table>
          <p style="margin:16px 0 0 0;color:#9ca3af;font-size:12px;">Mastery threshold is ${result.masteryPct}%. You're placed at the start of the first topic below mastery.</p>
        </td></tr>
        <tr><td style="padding:20px 32px;background-color:#1e293b;text-align:center;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">&copy; ${new Date().getFullYear()} The LEAGUE of Amazing Programmers &bull; <a href="https://www.jointheleague.org" style="color:#f37121;text-decoration:none;">jointheleague.org</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildPlacementText(params: { takerName: string; result: PlacementEmailResult }): string {
  const { takerName, result } = params;
  const levelName = PLACEMENT_LEVEL_NAMES[result.recommended.level] ?? result.recommended.level;
  const lesson = prettyPlacementLesson(result.recommended.lesson);
  const lines = [
    `Python Placement Result — ${takerName}`,
    '',
    `Recommended starting point: ${levelName}${lesson ? ` · ${lesson}` : ''}`,
  ];
  if (result.recommended.note) lines.push(result.recommended.note);
  lines.push(`Overall score: ${result.score}% (${result.correctCount}/${result.total})`, '', 'By topic:');
  for (const b of result.bandScores) {
    lines.push(`  - ${b.label}: ${b.correct}/${b.total} (${b.pct}%)${b.mastered ? ' ✓' : ''}`);
  }
  lines.push('', `Mastery threshold is ${result.masteryPct}%.`);
  return lines.join('\n');
}

/**
 * Email a placement result to the taker and (bcc) all admins. Best-effort:
 * resolves true if sent, false if email is not configured or the send failed.
 * Never throws, so the placement API can return its result regardless.
 */
export async function sendPlacementResultEmail(params: {
  takerName: string;
  takerEmail: string;
  adminEmails: string[];
  result: PlacementEmailResult;
  language?: 'python' | 'java';
}): Promise<boolean> {
  const from = process.env.SENDGRID_FROM_EMAIL;
  if (!process.env.SENDGRID_API_KEY || !from) {
    // eslint-disable-next-line no-console
    console.warn('[placement-email] SENDGRID not configured; skipping send.');
    return false;
  }
  const takerName = params.takerName?.trim() || 'there';
  const languageLabel = params.language === 'java' ? 'Java' : 'Python';
  const bcc = Array.from(
    new Set(params.adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean)),
  ).filter((e) => e !== params.takerEmail.trim().toLowerCase());

  try {
    await sgMail.send({
      to: params.takerEmail,
      ...(bcc.length ? { bcc } : {}),
      from,
      subject: `[LEAGUE] Your ${languageLabel} Placement Result — ${takerName}`,
      text: buildPlacementText({ takerName, result: params.result }),
      html: buildPlacementHtml({ takerName, result: params.result }),
    });
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[placement-email] send failed:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Parent quiz-result note (instructor-reviewed, sent to the guardian)
// ---------------------------------------------------------------------------

function buildParentQuizNoteHtml(params: {
  studentName: string;
  lessonName: string;
  score: number;
  passed: boolean;
  note: string;
}): string {
  const { studentName, lessonName, score, passed, note } = params;
  const noteLines = note
    .split('\n')
    .map((line) => `<p style="margin:0 0 12px 0;color:#374151;font-size:15px;line-height:1.6;">${line || '&nbsp;'}</p>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Quiz Result</title></head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background-color:#f37121;padding:28px 32px;text-align:center;">
          <img src="https://www.jointheleague.org/_astro/wordmark-h-1200.DPj-wZBK_Z2jTnVL.webp" alt="The LEAGUE of Amazing Programmers" width="260" style="display:block;margin:0 auto;max-width:260px;" />
        </td></tr>
        <tr><td style="background-color:#1e293b;padding:16px 32px;">
          <p style="margin:0;color:#ffffff;font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Quiz Result</p>
          <p style="margin:4px 0 0 0;color:#f37121;font-size:20px;font-weight:700;">${studentName} &mdash; ${lessonName}</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <div style="background-color:${passed ? '#f0fdf4' : '#fef2f2'};border-radius:8px;padding:20px;margin-bottom:24px;">
            <p style="margin:0;color:#6b7280;font-size:13px;">Score</p>
            <p style="margin:4px 0 0 0;color:${passed ? '#15803d' : '#b45309'};font-size:28px;font-weight:700;">${score}%</p>
            <p style="margin:6px 0 0 0;color:#374151;font-size:14px;">${passed ? 'Passed' : 'Keep practicing'}</p>
          </div>
          ${noteLines}
        </td></tr>
        <tr><td style="padding:20px 32px;background-color:#1e293b;text-align:center;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">&copy; ${new Date().getFullYear()} The LEAGUE of Amazing Programmers &bull; <a href="https://www.jointheleague.org" style="color:#f37121;text-decoration:none;">jointheleague.org</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Email an instructor-reviewed quiz-result note to a student's guardian.
 * Best-effort: returns true if sent, false if email is unconfigured or the send
 * failed. Never throws, so the API can return its result regardless.
 */
export async function sendParentQuizNote(params: {
  parentEmail: string;
  studentName: string;
  lessonName: string;
  score: number;
  passed: boolean;
  note: string;
}): Promise<boolean> {
  const from = process.env.SENDGRID_FROM_EMAIL;
  if (!process.env.SENDGRID_API_KEY || !from) {
    // eslint-disable-next-line no-console
    console.warn('[parent-quiz-note] SENDGRID not configured; skipping send.');
    return false;
  }
  const studentName = params.studentName?.trim() || 'your student';
  const noteText = params.note?.trim() || `${studentName} completed a quiz (${params.lessonName}) and scored ${params.score}%.`;
  try {
    await sgMail.send({
      to: params.parentEmail,
      from,
      subject: `[LEAGUE] Quiz Result — ${studentName}`,
      text: [
        `Quiz Result — ${studentName} (${params.lessonName})`,
        `Score: ${params.score}% (${params.passed ? 'Passed' : 'Keep practicing'})`,
        '',
        noteText,
      ].join('\n'),
      html: buildParentQuizNoteHtml({
        studentName,
        lessonName: params.lessonName,
        score: params.score,
        passed: params.passed,
        note: noteText,
      }),
    });
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[parent-quiz-note] send failed:', err);
    return false;
  }
}

export async function sendReviewEmail(params: {
  toEmail: string;
  studentName: string;
  month: string;
  reviewBody: string;
  feedbackToken: string;
}): Promise<void> {
  const feedbackUrl = `${APP_URL}/feedback/${params.feedbackToken}`;

  await sgMail.send({
    to: params.toEmail,
    from: process.env.SENDGRID_FROM_EMAIL!,
    subject: `[LEAGUE] Progress Report — ${params.studentName}, ${params.month}`,
    text: [params.reviewBody, '', '---', 'Please rate our service:', feedbackUrl, '', 'Parent satisfaction survey:', SURVEY_URL].join('\n'),
    html: buildEmailHtml({
      studentName: params.studentName,
      month: params.month,
      reviewBody: params.reviewBody,
      feedbackUrl,
    }),
  });
}

export async function sendTestReviewEmail(params: {
  toEmail: string;
  studentName: string;
  month: string;
  reviewBody: string;
  feedbackToken: string;
}): Promise<void> {
  const feedbackUrl = `${APP_URL}/feedback/${params.feedbackToken}`;

  await sgMail.send({
    to: params.toEmail,
    from: process.env.SENDGRID_FROM_EMAIL!,
    subject: `[TEST] Progress Report — ${params.studentName}, ${params.month}`,
    text: [`[TEST EMAIL]\n`, params.reviewBody, '', '---', 'Please rate our service:', feedbackUrl, '', 'Parent satisfaction survey:', SURVEY_URL].join('\n'),
    html: buildEmailHtml({
      studentName: params.studentName,
      month: `${params.month} [TEST]`,
      reviewBody: params.reviewBody,
      feedbackUrl,
    }),
  });
}
