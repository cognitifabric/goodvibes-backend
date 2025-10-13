export interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  scope?: string;
  token_type?: string;
};