const SLACK_API = 'https://slack.com/api';

function getToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN is not configured');
  return token;
}

/** Returns true if SLACK_BOT_TOKEN is set. */
export function isSlackConfigured(): boolean {
  return !!process.env.SLACK_BOT_TOKEN;
}

/**
 * Low-level helper — calls any Slack Web API method via POST.
 * Throws on HTTP error or Slack-level error (ok: false).
 */
async function callSlack(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!data.ok) {
    throw new Error(`Slack API error on ${method}: ${data.error}`);
  }
  return data;
}

/**
 * Look up a Slack user ID by their email address.
 * Returns null if the user is not found or Slack is not configured.
 */
export async function lookupSlackUserByEmail(email: string): Promise<string | null> {
  if (!isSlackConfigured()) return null;
  try {
    const res = await fetch(
      `${SLACK_API}/users.lookupByEmail?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${getToken()}` } },
    );
    const data = (await res.json()) as { ok: boolean; user?: { id: string } };
    return data.ok && data.user ? data.user.id : null;
  } catch {
    return null;
  }
}

/**
 * Send a direct message to the Slack user whose account matches the given email.
 * Returns true if the DM was sent, false if the user was not found in Slack.
 */
export async function sendSlackDM(email: string, text: string): Promise<boolean> {
  const userId = await lookupSlackUserByEmail(email);
  if (!userId) return false;

  const convData = await callSlack('conversations.open', { users: userId });
  const channelId = (convData.channel as { id: string }).id;

  await callSlack('chat.postMessage', { channel: channelId, text });
  return true;
}

/**
 * Post a message to a public or private Slack channel (e.g. "#reviews").
 * The channel must be configured in SLACK_REVIEWS_CHANNEL.
 */
export async function sendSlackChannelMessage(text: string): Promise<void> {
  const channel = process.env.SLACK_REVIEWS_CHANNEL;
  if (!channel) throw new Error('SLACK_REVIEWS_CHANNEL is not configured');
  await callSlack('chat.postMessage', { channel, text, mrkdwn: true });
}

/** Post a message to any channel, optionally in a thread. */
export async function postSlackMessage(channel: string, text: string, threadTs?: string): Promise<void> {
  const body: Record<string, unknown> = { channel, text, mrkdwn: true };
  if (threadTs) body.thread_ts = threadTs;
  await callSlack('chat.postMessage', body);
}
