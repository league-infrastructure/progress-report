import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY ?? '');

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
