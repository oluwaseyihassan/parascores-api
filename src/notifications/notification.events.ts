export const NotificationEvents = {
  SEND_TOURNAMENT_PUSH: 'notification.send-tournament-push',
} as const;

export interface SendTournamentPushPayload {
  tournamentId: string;
  title: string;
  body: string;
  url: string;
  tag: string;
  icon?: string;
}
