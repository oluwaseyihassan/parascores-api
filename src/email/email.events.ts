export const EmailEvents = {
  USER_SIGNUP: 'user.signup',
  USER_EMAIL_VERIFIED: 'user.email-verified',
  USER_PASSWORD_RESET: 'user.password-reset',
  USER_OAUTH_PASSWORD_RESET: 'user.oauth-password-reset',
  USER_GOOGLE_SIGNUP: 'user.google-signup',
  TEAM_JOIN_REQUEST: 'team.join-request',
  TEAM_JOIN_APPROVAL: 'team.join-approval',
  TEAM_JOIN_REJECTION: 'team.join-rejection',
  ORGANIZATION_MEMBER_ADDED: 'organization.member-added',
  ORGANIZATION_MEMBER_ROLE_UPDATED: 'organization.member-role-updated',
  ORGANIZATION_MEMBER_REMOVED: 'organization.member-removed',
  ORGANIZATION_DELETE_CODE: 'organization.delete-code',
  TOURNAMENT_JOIN_REQUEST: 'tournament.join-request',
  TOURNAMENT_JOIN_APPROVAL: 'tournament.join-approval',
  TOURNAMENT_JOIN_REJECTION: 'tournament.join-rejection',
} as const;

export interface UserSignupPayload {
  email: string;
  name: string;
  verificationToken: string;
}

export interface UserEmailVerifiedPayload {
  email: string;
  name: string;
}

export interface UserPasswordResetPayload {
  email: string;
  name: string;
  resetToken: string;
}

export interface UserOAuthPasswordResetPayload {
  email: string;
  name: string;
}

export interface UserGoogleSignupPayload {
  email: string;
  name: string;
}

export interface TeamJoinRequestPayload {
  organizerEmail: string;
  organizerName: string;
  playerName: string;
  teamName: string;
  tournamentName: string;
}

export interface TeamJoinApprovalPayload {
  playerEmail: string;
  playerName: string;
  teamName: string;
  tournamentName: string;
  customName: string;
}

export interface TeamJoinRejectionPayload {
  playerEmail: string;
  playerName: string;
  teamName: string;
  tournamentName: string;
}

export interface OrganizationMemberAddedPayload {
  email: string;
  name: string;
  organizationName: string;
  role: string;
}

export interface OrganizationMemberRoleUpdatedPayload {
  email: string;
  name: string;
  organizationName: string;
  newRole: string;
}

export interface OrganizationMemberRemovedPayload {
  email: string;
  name: string;
  organizationName: string;
}

export interface OrganizationDeleteCodePayload {
  email: string;
  name: string;
  organizationName: string;
  code: string;
  tournamentCount: number;
}

export interface TournamentJoinRequestPayload {
  organizerEmail: string;
  organizerName: string;
  teamName: string;
  tournamentName: string;
  dashboardUrl: string;
}

export interface TournamentJoinApprovalPayload {
  userEmail: string;
  userName: string;
  teamName: string;
  tournamentName: string;
  tournamentUrl: string;
}

export interface TournamentJoinRejectionPayload {
  userEmail: string;
  userName: string;
  teamName: string;
  tournamentName: string;
}
