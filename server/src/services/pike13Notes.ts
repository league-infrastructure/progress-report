const APP_URL = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const PIKE13_BASE_URL = new URL(process.env.PIKE13_API_BASE ?? 'https://pike13.com').origin;

const NL = '<br>';
const BLANK = '<br><br>';

/**
 * Post a note to a person's Pike13 profile using the instructor's OAuth access token.
 * The note appears in the person's timeline and can trigger Pike13's built-in
 * notification emails to the guardian if configured in the Pike13 account.
 */
export async function sendPike13Note(params: {
  accessToken: string;
  studentPike13Id: string;
  noteText: string;
}): Promise<void> {
  const { accessToken, studentPike13Id, noteText } = params;
  const url = `${PIKE13_BASE_URL}/api/v2/desk/people/${encodeURIComponent(studentPike13Id)}/notes`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ note: { note: noteText } }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pike13 Notes API returned ${res.status}: ${body}`);
  }
}

/**
 * Build an HTML-formatted note for Pike13.
 * Pike13 renders note bodies in an HTML context, so we use <br> and <b> tags
 * for reliable line breaks and emphasis instead of plain-text newlines.
 */
export function buildPike13NoteText(params: {
  reviewBody: string;
  studentName: string;
  month: string;
  feedbackToken: string;
}): string {
  const { reviewBody, studentName, month, feedbackToken } = params;
  const feedbackUrl = `${APP_URL}/feedback/${feedbackToken}`;

  const [year, mon] = (month ?? '').split('-');
  const monthLabel = year && mon
    ? new Date(Number(year), Number(mon) - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
    : 'this month';

  const bodyHtml = reviewBody.trim().replace(/\n/g, NL);

  return (
    `<b>THE LEAGUE OF AMAZING PROGRAMMERS</b>${NL}` +
    `<b>Monthly Progress Report — ${monthLabel} | Student: ${studentName}</b>` +
    BLANK +
    bodyHtml +
    BLANK +
    `<b>HOW ARE WE DOING?</b>${NL}` +
    `We value your feedback on ${studentName}'s experience with LEAGUE.${NL}` +
    `It only takes 30 seconds — rate us 1-5 stars and leave a comment:${NL}` +
    feedbackUrl +
    BLANK +
    'jointheleague.org'
  );
}
