export interface EngagementScoreInput {
  message_count?: number | null;
  response_rate?: number | null;
  last_message_at?: string | null;
}

/**
 * Calculate the display/API score at read time so its recency component
 * decays even when no new message fires the database refresh trigger.
 * Mirrors migration 038: recency 40%, frequency 30%, responsiveness 30%.
 */
export function calculateEngagementScore(
  input: EngagementScoreInput,
  nowMs = Date.now()
): number {
  const messageCount = Math.max(0, Number(input.message_count) || 0);
  const responseRate = Math.min(
    100,
    Math.max(0, Number(input.response_rate) || 0)
  );

  let recency = 0;
  const lastMessageMs = input.last_message_at
    ? Date.parse(input.last_message_at)
    : Number.NaN;
  if (Number.isFinite(lastMessageMs)) {
    const age = Math.max(0, nowMs - lastMessageMs);
    const hour = 60 * 60 * 1000;
    if (age <= hour) recency = 40;
    else if (age <= 24 * hour) recency = 30;
    else if (age <= 7 * 24 * hour) recency = 20;
    else if (age <= 30 * 24 * hour) recency = 10;
  }

  const frequency =
    messageCount >= 50
      ? 30
      : messageCount >= 20
        ? 25
        : messageCount >= 10
          ? 20
          : messageCount >= 5
            ? 15
            : messageCount >= 1
              ? 10
              : 0;

  return Math.min(100, Math.round((recency + frequency + responseRate * 0.3) * 100) / 100);
}
