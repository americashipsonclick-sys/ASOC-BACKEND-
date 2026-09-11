export type VoiceIntent = "accept" | "unknown";

const ACCEPT_PATTERNS = [
  /\baccept this load\b/i,
  /\baccept it\b/i,
  /\baccept the load\b/i,
  /\bbook it\b/i,
  /\bbook this load\b/i,
  /\bbook the load\b/i,
  /\btake this load\b/i,
];

export function parseVoiceCommand(transcript: string): VoiceIntent {
  const text = transcript.trim();
  if (!text) return "unknown";
  return ACCEPT_PATTERNS.some((re) => re.test(text)) ? "accept" : "unknown";
}
