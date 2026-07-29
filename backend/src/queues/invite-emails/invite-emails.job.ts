/** Shared name + payload for the invite-emails queue (producer and worker). */
export const INVITE_EMAILS_QUEUE = 'invite-emails';

export interface InviteEmailJob {
  to: string;
  candidateName: string;
  assessmentTitle: string;
  registerUrl: string;
}
